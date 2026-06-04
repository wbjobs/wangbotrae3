use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use anyhow::{anyhow, Result};
use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::dot::{Dot, Config};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ProgramState {
    pub id: String,
    pub pc: u64,
    pub call_stack: Vec<u64>,
    pub coverage_hash: String,
    pub memory_signature: Option<String>,
}

impl ProgramState {
    pub fn new(pc: u64, call_stack: Vec<u64>, coverage_hash: String) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(pc.to_le_bytes());
        for &addr in &call_stack {
            hasher.update(addr.to_le_bytes());
        }
        hasher.update(coverage_hash.as_bytes());
        let hash = hasher.finalize();
        let id = hex::encode(&hash[..16]);

        Self {
            id,
            pc,
            call_stack,
            coverage_hash,
            memory_signature: None,
        }
    }

    pub fn from_coverage(coverage: &crate::coverage::Coverage) -> Self {
        let coverage_hash = coverage.compute_hash();
        let blocks: Vec<u64> = coverage.blocks.iter().cloned().collect();
        let pc = blocks.first().copied().unwrap_or(0);
        Self::new(pc, blocks, coverage_hash)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct StateTransition {
    pub from: String,
    pub to: String,
    pub input_hash: String,
    pub input_length: usize,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolStateMachine {
    pub states: HashMap<String, ProgramState>,
    pub transitions: Vec<StateTransition>,
    pub initial_state: Option<String>,
    pub accept_states: HashSet<String>,
    pub transition_counts: HashMap<(String, String), u64>,
}

impl ProtocolStateMachine {
    pub fn new() -> Self {
        Self {
            states: HashMap::new(),
            transitions: Vec::new(),
            initial_state: None,
            accept_states: HashSet::new(),
            transition_counts: HashMap::new(),
        }
    }

    pub fn add_state(&mut self, state: ProgramState) {
        if self.initial_state.is_none() {
            self.initial_state = Some(state.id.clone());
        }
        self.states.insert(state.id.clone(), state);
    }

    pub fn add_transition(&mut self, from: &ProgramState, to: &ProgramState, input: &[u8]) {
        let input_hash = Self::hash_input(input);
        
        self.add_state(from.clone());
        self.add_state(to.clone());

        let key = (from.id.clone(), to.id.clone());
        *self.transition_counts.entry(key).or_insert(0) += 1;

        let transition = StateTransition {
            from: from.id.clone(),
            to: to.id.clone(),
            input_hash,
            input_length: input.len(),
            count: 1,
        };

        self.transitions.push(transition);
    }

    fn hash_input(input: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(input);
        let hash = hasher.finalize();
        hex::encode(&hash[..8])
    }

    pub fn merge_duplicate_transitions(&mut self) {
        let mut unique = HashMap::new();

        for t in std::mem::take(&mut self.transitions) {
            let key = (t.from.clone(), t.to.clone(), t.input_hash.clone());
            let entry = unique.entry(key).or_insert_with(|| t.clone());
            entry.count += t.count;
        }

        self.transitions = unique.into_values().collect();
    }

    pub fn prune_infrequent(&mut self, min_count: u64) {
        self.transitions.retain(|t| t.count >= min_count);
        
        let active_states: HashSet<String> = self.transitions
            .iter()
            .flat_map(|t| vec![t.from.clone(), t.to.clone()])
            .collect();
        
        self.states.retain(|id, _| active_states.contains(id));
    }

    pub fn to_graph(&self) -> DiGraph<String, String> {
        let mut graph = DiGraph::new();
        let mut node_indices = HashMap::new();

        for (id, state) in &self.states {
            let label = format!("S{}\npc: {:#x}", &id[..8], state.pc);
            let idx = graph.add_node(label);
            node_indices.insert(id.clone(), idx);
        }

        for transition in &self.transitions {
            if let (Some(&from_idx), Some(&to_idx)) = (
                node_indices.get(&transition.from),
                node_indices.get(&transition.to),
            ) {
                let label = format!("{}\n({} bytes)", 
                    &transition.input_hash[..6], transition.input_length);
                graph.add_edge(from_idx, to_idx, label);
            }
        }

        graph
    }

    pub fn export_dot<P: AsRef<Path>>(&self, path: P) -> Result<()> {
        let graph = self.to_graph();
        let dot = Dot::with_config(&graph, &[Config::EdgeNoLabel]);
        
        let mut file = File::create(path)?;
        writeln!(file, "digraph ProtocolStateMachine {{")?;
        writeln!(file, "    rankdir=LR;")?;
        writeln!(file, "    node [shape=box, style=filled, fillcolor=lightblue];")?;
        
        for (id, state) in &self.states {
            let short_id = &id[..8];
            let label = format!("S_{}\\lPC: {:#x}\\lStack: {}\\l", 
                short_id, state.pc, state.call_stack.len());
            writeln!(file, "    \"{}\" [label=\"{}\"];", short_id, label)?;
        }

        for transition in &self.transitions {
            let from_short = &transition.from[..8];
            let to_short = &transition.to[..8];
            writeln!(file, "    \"{}\" -> \"{}\" [label=\"{}B ({}x)\"];",
                from_short, to_short, transition.input_length, transition.count)?;
        }

        writeln!(file, "}}")?;
        
        Ok(())
    }

    pub fn shortest_path(&self, from: &str, to: &str) -> Option<Vec<String>> {
        let mut queue = VecDeque::new();
        let mut visited = HashSet::new();
        let mut parent = HashMap::new();

        queue.push_back(from.to_string());
        visited.insert(from.to_string());

        while let Some(current) = queue.pop_front() {
            if current == to {
                let mut path = Vec::new();
                let mut node = current;
                path.push(node.clone());
                
                while let Some(p) = parent.get(&node) {
                    path.push(p.clone());
                    node = p.clone();
                }
                
                path.reverse();
                return Some(path);
            }

            for transition in &self.transitions {
                if transition.from == current {
                    if !visited.contains(&transition.to) {
                        visited.insert(transition.to.clone());
                        parent.insert(transition.to.clone(), current.clone());
                        queue.push_back(transition.to.clone());
                    }
                }
            }
        }

        None
    }

    pub fn save<P: AsRef<Path>>(&self, path: P) -> Result<()> {
        let json = serde_json::to_string_pretty(self)?;
        fs::write(path, json)?;
        Ok(())
    }

    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self> {
        let data = fs::read(path)?;
        let fsm: ProtocolStateMachine = serde_json::from_slice(&data)?;
        Ok(fsm)
    }

    pub fn stats(&self) -> FsmStats {
        FsmStats {
            num_states: self.states.len(),
            num_transitions: self.transitions.len(),
            initial_state: self.initial_state.clone(),
            num_accept_states: self.accept_states.len(),
        }
    }
}

impl Default for ProtocolStateMachine {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FsmStats {
    pub num_states: usize,
    pub num_transitions: usize,
    pub initial_state: Option<String>,
    pub num_accept_states: usize,
}

pub struct StateMachineInferrer {
    fsm: ProtocolStateMachine,
    state_history: Vec<ProgramState>,
    max_history: usize,
}

impl StateMachineInferrer {
    pub fn new() -> Self {
        Self {
            fsm: ProtocolStateMachine::new(),
            state_history: Vec::new(),
            max_history: 10000,
        }
    }

    pub fn with_max_history(mut self, max: usize) -> Self {
        self.max_history = max;
        self
    }

    pub fn observe_transition(&mut self, input: &[u8], coverage: &crate::coverage::Coverage) {
        let current_state = ProgramState::from_coverage(coverage);
        
        if let Some(prev_state) = self.state_history.last() {
            self.fsm.add_transition(prev_state, &current_state, input);
        }

        self.state_history.push(current_state);
        
        if self.state_history.len() > self.max_history {
            self.state_history.remove(0);
        }
    }

    pub fn finalize(&mut self) -> ProtocolStateMachine {
        self.fsm.merge_duplicate_transitions();
        self.fsm.clone()
    }

    pub fn fsm(&self) -> &ProtocolStateMachine {
        &self.fsm
    }
}

impl Default for StateMachineInferrer {
    fn default() -> Self {
        Self::new()
    }
}

pub struct SessionAnalyzer {
    log_dir: String,
}

impl SessionAnalyzer {
    pub fn new(log_dir: &str) -> Self {
        Self {
            log_dir: log_dir.to_string(),
        }
    }

    pub fn build_state_machine(&self) -> Result<ProtocolStateMachine> {
        let mut fsm = ProtocolStateMachine::new();
        let log_path = Path::new(&self.log_dir);
        
        if !log_path.exists() {
            return Err(anyhow!("Log directory does not exist"));
        }

        let mut coverage_files = Vec::new();
        for entry in fs::read_dir(log_path)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("cov") {
                coverage_files.push(path);
            }
        }

        coverage_files.sort();

        let mut prev_state: Option<ProgramState> = None;
        
        for cov_file in coverage_files {
            let data = fs::read(&cov_file)?;
            if data.len() < 8 {
                continue;
            }

            let coverage = parse_coverage_log(&data)?;
            let current_state = ProgramState::from_coverage(&coverage);

            if let Some(prev) = prev_state.take() {
                let input_data = extract_input_from_filename(&cov_file);
                fsm.add_transition(&prev, &current_state, &input_data);
            }

            prev_state = Some(current_state);
        }

        fsm.merge_duplicate_transitions();
        Ok(fsm)
    }
}

fn parse_coverage_log(data: &[u8]) -> Result<crate::coverage::Coverage> {
    let mut coverage = crate::coverage::Coverage::new();
    
    let mut offset = 0;
    while offset + 8 <= data.len() {
        let edge = u64::from_le_bytes(data[offset..offset + 8].try_into()?);
        coverage.add_edge(edge);
        offset += 8;
    }

    Ok(coverage)
}

fn extract_input_from_filename(path: &Path) -> Vec<u8> {
    let filename = path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("input.bin");
    
    filename.as_bytes().to_vec()
}
