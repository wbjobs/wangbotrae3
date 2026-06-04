use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use anyhow::{anyhow, Result};
use crossbeam_channel::{unbounded, Receiver, Sender};
use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::coverage::*;
use crate::crash::*;
use crate::mutator::*;
use crate::seed::*;
use crate::statemachine::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FuzzConfig {
    pub target: String,
    pub input_dir: String,
    pub output_dir: String,
    pub workers: usize,
    pub timeout: u64,
    pub max_crashes: usize,
    pub coverage_backend: CoverageBackend,
    pub enable_statemachine: bool,
}

impl Default for FuzzConfig {
    fn default() -> Self {
        Self {
            target: String::new(),
            input_dir: "seeds/".to_string(),
            output_dir: "output/".to_string(),
            workers: 1,
            timeout: 30,
            max_crashes: 1000,
            coverage_backend: CoverageBackend::Qemu,
            enable_statemachine: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FuzzStats {
    pub start_time: Instant,
    pub total_executions: u64,
    pub executions_per_second: f64,
    pub total_crashes: u64,
    pub unique_crashes: u64,
    pub total_coverage: u64,
    pub corpus_size: usize,
    pub last_new_path: Option<Duration>,
    pub last_crash: Option<Duration>,
}

impl Default for FuzzStats {
    fn default() -> Self {
        Self {
            start_time: Instant::now(),
            total_executions: 0,
            executions_per_second: 0.0,
            total_crashes: 0,
            unique_crashes: 0,
            total_coverage: 0,
            corpus_size: 0,
            last_new_path: None,
            last_crash: None,
        }
    }
}

pub enum FuzzMessage {
    NewTestCase(Vec<u8>, Coverage),
    Crash(CrashInfo),
    StatsUpdate(FuzzStats),
    Stop,
}

pub struct Fuzzer {
    config: FuzzConfig,
    seed_manager: SeedManager,
    coverage_collector: CoverageCollector,
    crash_analyzer: Arc<Mutex<CrashAnalyzer>>,
    state_inferrer: Option<StateMachineInferrer>,
    stats: Arc<Mutex<FuzzStats>>,
    running: Arc<Mutex<bool>>,
}

impl Fuzzer {
    pub fn new(config: FuzzConfig) -> Result<Self> {
        fs::create_dir_all(&config.output_dir)?;
        fs::create_dir_all(format!("{}/crashes", config.output_dir))?;
        fs::create_dir_all(format!("{}/corpus", config.output_dir))?;

        let seed_manager = SeedManager::new(
            &config.input_dir,
            format!("{}/corpus", config.output_dir),
        )?;

        let coverage_collector = CoverageCollector::new(config.coverage_backend.clone());

        let crash_analyzer = Arc::new(Mutex::new(CrashAnalyzer::new(
            format!("{}/crashes", config.output_dir),
        )));

        let state_inferrer = if config.enable_statemachine {
            Some(StateMachineInferrer::new())
        } else {
            None
        };

        Ok(Self {
            config,
            seed_manager,
            coverage_collector,
            crash_analyzer,
            state_inferrer,
            stats: Arc::new(Mutex::new(FuzzStats::default())),
            running: Arc::new(Mutex::new(true)),
        })
    }

    pub fn run(&mut self) -> Result<()> {
        let seed_count = self.seed_manager.load_seeds()?;
        log::info!("Loaded {} seeds", seed_count);

        if self.seed_manager.count() == 0 {
            return Err(anyhow!("No seeds found in input directory"));
        }

        let (tx, rx) = unbounded();
        
        self.start_workers(tx.clone())?;

        self.run_event_loop(rx)?;

        Ok(())
    }

    fn start_workers(&self, tx: Sender<FuzzMessage>) -> Result<()> {
        for worker_id in 0..self.config.workers {
            let worker = FuzzWorker::new(
                worker_id,
                self.config.clone(),
                tx.clone(),
                self.coverage_collector.clone(),
            );
            
            std::thread::spawn(move || {
                if let Err(e) = worker.run() {
                    log::error!("Worker {} error: {}", worker_id, e);
                }
            });
        }

        Ok(())
    }

    fn run_event_loop(&mut self, rx: Receiver<FuzzMessage>) -> Result<()> {
        let mut last_status = Instant::now();

        while *self.running.lock().unwrap() {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(FuzzMessage::NewTestCase(input, coverage)) => {
                    self.handle_new_path(input, coverage)?;
                }
                Ok(FuzzMessage::Crash(crash)) => {
                    self.handle_crash(crash)?;
                }
                Ok(FuzzMessage::StatsUpdate(stats)) => {
                    *self.stats.lock().unwrap() = stats;
                }
                Ok(FuzzMessage::Stop) => {
                    *self.running.lock().unwrap() = false;
                    break;
                }
                Err(_) => {}
            }

            if last_status.elapsed() >= Duration::from_secs(1) {
                self.print_status();
                last_status = Instant::now();
            }
        }

        self.finalize()?;
        Ok(())
    }

    fn handle_new_path(&mut self, input: Vec<u8>, coverage: Coverage) -> Result<()> {
        let filename = format!("id_{:08x}.bin", rand::thread_rng().gen::<u32>());
        let mut seed = Seed::new(input, filename);
        seed.coverage_hash = Some(coverage.compute_hash());
        seed.metadata.source = SeedSource::Mutation;

        self.seed_manager.save_interesting(seed)?;
        
        if let Some(inferrer) = &mut self.state_inferrer {
            inferrer.observe_transition(&[], &coverage);
        }

        let mut stats = self.stats.lock().unwrap();
        stats.total_coverage = coverage.edge_count;
        stats.corpus_size = self.seed_manager.count();
        stats.last_new_path = Some(stats.start_time.elapsed());

        Ok(())
    }

    fn handle_crash(&mut self, crash: CrashInfo) -> Result<()> {
        let mut analyzer = self.crash_analyzer.lock().unwrap();
        analyzer.analyze(crash)?;

        let mut stats = self.stats.lock().unwrap();
        stats.total_crashes += 1;
        stats.unique_crashes = analyzer.classifier().unique_count() as u64;
        stats.last_crash = Some(stats.start_time.elapsed());

        if stats.unique_crashes >= self.config.max_crashes as u64 {
            log::info!("Reached maximum unique crashes, stopping...");
            *self.running.lock().unwrap() = false;
        }

        Ok(())
    }

    fn print_status(&self) {
        let stats = self.stats.lock().unwrap();
        let elapsed = stats.start_time.elapsed().as_secs_f64();
        let execs_per_sec = if elapsed > 0.0 {
            stats.total_executions as f64 / elapsed
        } else {
            0.0
        };

        log::info!(
            "[{:>8.0}s] execs: {:>10} ({:>8.0}/s) | coverage: {:>6} edges | corpus: {:>5} | crashes: {:>4} ({:>3} unique)",
            elapsed,
            stats.total_executions,
            execs_per_sec,
            stats.total_coverage,
            stats.corpus_size,
            stats.total_crashes,
            stats.unique_crashes,
        );
    }

    fn finalize(&mut self) -> Result<()> {
        log::info!("Finalizing fuzzing session...");

        if let Some(inferrer) = &mut self.state_inferrer {
            let fsm = inferrer.finalize();
            let fsm_path = format!("{}/statemachine.json", self.config.output_dir);
            fsm.save(&fsm_path)?;
            log::info!("State machine saved to: {}", fsm_path);
        }

        let mut analyzer = self.crash_analyzer.lock().unwrap();
        let unique = analyzer.save_all()?;
        log::info!("Saved {} unique crashes", unique);

        let summary = analyzer.generate_summary()?;
        let summary_path = format!("{}/crash_summary.txt", self.config.output_dir);
        fs::write(&summary_path, summary)?;
        log::info!("Crash summary saved to: {}", summary_path);

        Ok(())
    }

    pub fn stop(&self) {
        *self.running.lock().unwrap() = false;
    }
}

struct FuzzWorker {
    id: usize,
    config: FuzzConfig,
    tx: Sender<FuzzMessage>,
    coverage_collector: CoverageCollector,
    mutator: Mutator,
    local_stats: FuzzStats,
}

impl FuzzWorker {
    fn new(
        id: usize,
        config: FuzzConfig,
        tx: Sender<FuzzMessage>,
        coverage_collector: CoverageCollector,
    ) -> Self {
        let seed = rand::thread_rng().gen::<u64>();
        Self {
            id,
            config,
            tx,
            coverage_collector,
            mutator: Mutator::new(seed),
            local_stats: FuzzStats::default(),
        }
    }

    fn run(mut self) -> Result<()> {
        log::debug!("Worker {} started", self.id);

        loop {
            let corpus_path = Path::new(&self.config.output_dir).join("corpus");
            let seed_files: Vec<PathBuf> = fs::read_dir(&corpus_path)
                .map(|entries| {
                    entries
                        .filter_map(|e| e.ok())
                        .map(|e| e.path())
                        .filter(|p| p.is_file())
                        .collect()
                })
                .unwrap_or_default();

            if seed_files.is_empty() {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }

            let idx = rand::thread_rng().gen_range(0..seed_files.len());
            let seed_path = &seed_files[idx];
            
            if let Ok(seed_data) = fs::read(seed_path) {
                let mutated = self.mutator.mutate(&seed_data);
                
                match self.run_test_case(&mutated) {
                    Ok((true, coverage)) => {
                        let _ = self.tx.send(FuzzMessage::NewTestCase(mutated, coverage));
                    }
                    Ok((false, _)) => {}
                    Err(e) => {
                        log::debug!("Test case error: {}", e);
                    }
                }
            }

            self.local_stats.total_executions += 1;

            if self.local_stats.total_executions % 1000 == 0 {
                let _ = self.tx.send(FuzzMessage::StatsUpdate(self.local_stats.clone()));
            }
        }
    }

    fn run_test_case(&self, input: &[u8]) -> Result<(bool, Coverage)> {
        use std::io::Write;
        use std::process::{Command, Stdio};

        let cov_file = format!("/tmp/coverage_{}_{}.bin", self.id, std::process::id());
        
        let mut cmd = Command::new(&self.config.target);
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let mut child = cmd.spawn()?;

        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(input);
        }

        let status = child.wait()?;

        let coverage = if Path::new(&cov_file).exists() {
            self.coverage_collector.load_coverage_from_file(&cov_file)?
        } else {
            Coverage::new()
        };

        let _ = fs::remove_file(&cov_file);

        if !status.success() {
            if let Some(code) = status.code() {
                if code < 128 {
                    let crash = CrashInfo::new(input, -code);
                    let _ = self.tx.send(FuzzMessage::Crash(crash));
                }
            }
        }

        let has_new = coverage.edge_count > 0;
        Ok((has_new, coverage))
    }
}
