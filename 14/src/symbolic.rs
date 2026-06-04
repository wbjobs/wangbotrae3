use crate::formats::{CooMatrix, SparseError};
use serde::{Serialize, Deserialize};
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};

pub type ExprId = u64;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ExprKind {
    Variable(String),
    Constant,
    Zero,
    Add(Vec<ExprId>),
    Mul(Vec<ExprId>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExprRegistry {
    entries: HashMap<ExprId, ExprKind>,
    hash_to_id: HashMap<u64, ExprId>,
    next_id: ExprId,
    zero_id: ExprId,
    sparsity_cache: HashMap<ExprId, HashSet<usize>>,
    nnz_estimate_cache: HashMap<ExprId, usize>,
}

impl ExprRegistry {
    pub fn new() -> Self {
        let mut reg = ExprRegistry {
            entries: HashMap::new(),
            hash_to_id: HashMap::new(),
            next_id: 1,
            zero_id: 0,
            sparsity_cache: HashMap::new(),
            nnz_estimate_cache: HashMap::new(),
        };
        reg.zero_id = reg.insert(ExprKind::Zero);
        reg
    }

    pub fn insert(&mut self, kind: ExprKind) -> ExprId {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        kind.hash(&mut hasher);
        let hash = hasher.finish();

        if let Some(&existing_id) = self.hash_to_id.get(&hash) {
            if self.entries.get(&existing_id) == Some(&kind) {
                return existing_id;
            }
        }

        let id = self.next_id;
        self.next_id += 1;
        self.entries.insert(id, kind.clone());
        self.hash_to_id.insert(hash, id);
        id
    }

    pub fn get(&self, id: ExprId) -> Option<&ExprKind> {
        self.entries.get(&id)
    }

    pub fn is_zero(&self, id: ExprId) -> bool {
        id == self.zero_id || matches!(self.entries.get(&id), Some(ExprKind::Zero))
    }

    pub fn is_constant(&self, id: ExprId) -> bool {
        matches!(self.entries.get(&id), Some(ExprKind::Constant))
    }

    pub fn variable(&mut self, name: impl Into<String>) -> ExprId {
        self.insert(ExprKind::Variable(name.into()))
    }

    pub fn constant(&mut self) -> ExprId {
        self.insert(ExprKind::Constant)
    }

    pub fn zero(&self) -> ExprId {
        self.zero_id
    }

    pub fn add(&mut self, terms: Vec<ExprId>) -> ExprId {
        let mut deduped: Vec<ExprId> = terms
            .into_iter()
            .filter(|&id| !self.is_zero(id))
            .collect();
        deduped.sort();
        deduped.dedup();

        if deduped.is_empty() {
            return self.zero_id;
        }
        if deduped.len() == 1 {
            return deduped[0];
        }
        self.insert(ExprKind::Add(deduped))
    }

    pub fn mul(&mut self, terms: Vec<ExprId>) -> ExprId {
        if terms.iter().any(|&id| self.is_zero(id)) {
            return self.zero_id;
        }

        let filtered: Vec<ExprId> = terms
            .into_iter()
            .filter(|&id| !self.is_constant(id))
            .collect();

        if filtered.is_empty() {
            return self.constant();
        }
        if filtered.len() == 1 {
            return filtered[0];
        }

        self.insert(ExprKind::Mul(filtered))
    }

    pub fn expr_count(&self) -> usize {
        self.entries.len()
    }

    pub fn clear_caches(&mut self) {
        self.sparsity_cache.clear();
        self.nnz_estimate_cache.clear();
    }

    pub fn get_cached_sparsity(&self, id: ExprId) -> Option<&HashSet<usize>> {
        self.sparsity_cache.get(&id)
    }

    pub fn cache_sparsity(&mut self, id: ExprId, deps: HashSet<usize>) {
        self.sparsity_cache.insert(id, deps);
    }

    pub fn get_cached_nnz_estimate(&self, id: ExprId) -> Option<usize> {
        self.nnz_estimate_cache.get(&id).copied()
    }

    pub fn cache_nnz_estimate(&mut self, id: ExprId, estimate: usize) {
        self.nnz_estimate_cache.insert(id, estimate);
    }
}

impl Default for ExprRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolicMatrix {
    pub rows: usize,
    pub cols: usize,
    pub elements: HashMap<(usize, usize), ExprId>,
    #[serde(skip)]
    pub registry: ExprRegistry,
}

impl SymbolicMatrix {
    pub fn new(rows: usize, cols: usize) -> Self {
        SymbolicMatrix {
            rows,
            cols,
            elements: HashMap::new(),
            registry: ExprRegistry::new(),
        }
    }

    pub fn from_coo(matrix: &CooMatrix, name: Option<&str>) -> Self {
        let mut reg = ExprRegistry::new();
        let mut elements = HashMap::new();
        for i in 0..matrix.nnz() {
            let r = matrix.row_indices[i];
            let c = matrix.col_indices[i];
            let v = matrix.values[i];
            let id = if v == 0.0 {
                reg.zero()
            } else if let Some(n) = name {
                reg.variable(format!("{}[{},{}]", n, r, c))
            } else {
                reg.constant()
            };
            elements.insert((r, c), id);
        }
        SymbolicMatrix {
            rows: matrix.rows,
            cols: matrix.cols,
            elements,
            registry: reg,
        }
    }

    pub fn from_sparsity_pattern(
        rows: usize,
        cols: usize,
        positions: &HashSet<(usize, usize)>,
        name: &str,
    ) -> Self {
        let mut reg = ExprRegistry::new();
        let mut elements = HashMap::new();
        for &(r, c) in positions {
            let id = reg.variable(format!("{}[{},{}]", name, r, c));
            elements.insert((r, c), id);
        }
        SymbolicMatrix {
            rows,
            cols,
            elements,
            registry: reg,
        }
    }

    pub fn nnz(&self) -> usize {
        self.elements
            .values()
            .filter(|&&id| !self.registry.is_zero(id))
            .count()
    }

    pub fn sparsity_pattern(&self) -> HashSet<(usize, usize)> {
        self.elements
            .iter()
            .filter(|(_, &id)| !self.registry.is_zero(id))
            .map(|(&pos, _)| pos)
            .collect()
    }

    pub fn add(&mut self, other: &SymbolicMatrix) -> Result<(), SparseError> {
        if self.rows != other.rows || self.cols != other.cols {
            return Err(SparseError::InvalidDimensions);
        }

        for (&pos, &other_id) in &other.elements {
            if other.registry.is_zero(other_id) {
                continue;
            }
            let self_id = self.elements.get(&pos).cloned();
            match self_id {
                None => {
                    let cloned = self.import_expr(other, other_id);
                    self.elements.insert(pos, cloned);
                }
                Some(sid) if self.registry.is_zero(sid) => {
                    let cloned = self.import_expr(other, other_id);
                    self.elements.insert(pos, cloned);
                }
                Some(existing_id) => {
                    let cloned = self.import_expr(other, other_id);
                    let sum_id = self.registry.add(vec![existing_id, cloned]);
                    self.elements.insert(pos, sum_id);
                }
            }
        }

        Ok(())
    }

    pub fn multiply(&self, other: &SymbolicMatrix) -> Result<SymbolicMatrix, SparseError> {
        if self.cols != other.rows {
            return Err(SparseError::InvalidDimensions);
        }

        let mut result = SymbolicMatrix::new(self.rows, other.cols);

        let mut a_by_col: HashMap<usize, Vec<(usize, ExprId)>> = HashMap::new();
        for (&(r, c), &id) in &self.elements {
            if !self.registry.is_zero(id) {
                a_by_col.entry(c).or_default().push((r, id));
            }
        }

        let mut b_by_row: HashMap<usize, Vec<(usize, ExprId)>> = HashMap::new();
        for (&(r, c), &id) in &other.elements {
            if !other.registry.is_zero(id) {
                b_by_row.entry(r).or_default().push((c, id));
            }
        }

        for k in 0..self.cols {
            if let (Some(a_entries), Some(b_entries)) = (a_by_col.get(&k), b_by_row.get(&k)) {
                for &(i, a_id) in a_entries {
                    for &(j, b_id) in b_entries {
                        let product_id = result.registry.mul(vec![a_id, b_id]);
                        if result.registry.is_zero(product_id) {
                            continue;
                        }
                        match result.elements.get(&(i, j)) {
                            None => {
                                result.elements.insert((i, j), product_id);
                            }
                            Some(&existing_id) => {
                                let sum_id = result.registry.add(vec![existing_id, product_id]);
                                result.elements.insert((i, j), sum_id);
                            }
                        }
                    }
                }
            }
        }

        Ok(result)
    }

    pub fn transpose(&self) -> SymbolicMatrix {
        let mut elements = HashMap::new();
        for (&(r, c), &id) in &self.elements {
            elements.insert((c, r), id);
        }
        SymbolicMatrix {
            rows: self.cols,
            cols: self.rows,
            elements,
            registry: self.registry.clone(),
        }
    }

    fn import_expr(&mut self, source: &SymbolicMatrix, source_id: ExprId) -> ExprId {
        if source.registry.is_zero(source_id) {
            return self.registry.zero();
        }
        match source.registry.get(source_id) {
            None => self.registry.zero(),
            Some(ExprKind::Variable(name)) => self.registry.variable(name.clone()),
            Some(ExprKind::Constant) => self.registry.constant(),
            Some(ExprKind::Zero) => self.registry.zero(),
            Some(ExprKind::Add(terms)) => {
                let imported: Vec<ExprId> = terms
                    .iter()
                    .map(|&t| self.import_expr(source, t))
                    .collect();
                self.registry.add(imported)
            }
            Some(ExprKind::Mul(terms)) => {
                let imported: Vec<ExprId> = terms
                    .iter()
                    .map(|&t| self.import_expr(source, t))
                    .collect();
                self.registry.mul(imported)
            }
        }
    }
}

pub fn format_expr(registry: &ExprRegistry, id: ExprId) -> String {
    if registry.is_zero(id) {
        return "0".to_string();
    }
    match registry.get(id) {
        None => "?".to_string(),
        Some(ExprKind::Variable(name)) => name.clone(),
        Some(ExprKind::Constant) => "c".to_string(),
        Some(ExprKind::Zero) => "0".to_string(),
        Some(ExprKind::Add(terms)) => {
            let parts: Vec<String> = terms.iter().map(|&t| format_expr(registry, t)).collect();
            format!("({})", parts.join(" + "))
        }
        Some(ExprKind::Mul(terms)) => {
            let parts: Vec<String> = terms.iter().map(|&t| format_expr(registry, t)).collect();
            format!("({})", parts.join(" * "))
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolicVector {
    pub size: usize,
    pub elements: HashMap<usize, ExprId>,
    #[serde(skip)]
    pub registry: ExprRegistry,
}

impl SymbolicVector {
    pub fn new(size: usize) -> Self {
        SymbolicVector {
            size,
            elements: HashMap::new(),
            registry: ExprRegistry::new(),
        }
    }

    pub fn from_variables(size: usize, name: &str) -> Self {
        let mut reg = ExprRegistry::new();
        let mut elements = HashMap::new();
        for i in 0..size {
            let id = reg.variable(format!("{}[{}]", name, i));
            elements.insert(i, id);
        }
        SymbolicVector {
            size,
            elements,
            registry: reg,
        }
    }

    pub fn sparsity_pattern(&self) -> HashSet<usize> {
        self.elements
            .iter()
            .filter(|(_, &id)| !self.registry.is_zero(id))
            .map(|(&idx, _)| idx)
            .collect()
    }
}

pub fn symbolic_matrix_vector_mul(
    matrix: &SymbolicMatrix,
    vector: &SymbolicVector,
) -> Result<SymbolicVector, SparseError> {
    if matrix.cols != vector.size {
        return Err(SparseError::InvalidDimensions);
    }

    let mut result = SymbolicVector::new(matrix.rows);

    for (&(r, c), &m_id) in &matrix.elements {
        if matrix.registry.is_zero(m_id) {
            continue;
        }
        if let Some(&v_id) = vector.elements.get(&c) {
            if vector.registry.is_zero(v_id) {
                continue;
            }
            let product_id = result.registry.mul(vec![m_id, v_id]);
            if result.registry.is_zero(product_id) {
                continue;
            }
            match result.elements.get(&r) {
                None => {
                    result.elements.insert(r, product_id);
                }
                Some(&existing_id) => {
                    let sum_id = result.registry.add(vec![existing_id, product_id]);
                    result.elements.insert(r, sum_id);
                }
            }
        }
    }

    Ok(result)
}

pub fn extract_variable_dependencies_cached(
    registry: &mut ExprRegistry,
    id: ExprId,
    visiting: &mut HashSet<ExprId>,
) -> HashSet<usize> {
    if registry.is_zero(id) {
        return HashSet::new();
    }

    if let Some(cached) = registry.get_cached_sparsity(id) {
        return cached.clone();
    }

    if visiting.contains(&id) {
        return HashSet::new();
    }
    visiting.insert(id);

    let kind_snapshot = registry.get(id).cloned();

    let deps = match kind_snapshot {
        None => HashSet::new(),
        Some(ExprKind::Variable(name)) => {
            extract_index_from_var(&name)
                .into_iter()
                .collect()
        }
        Some(ExprKind::Add(terms)) | Some(ExprKind::Mul(terms)) => {
            let mut combined = HashSet::new();
            for term_id in terms {
                combined.extend(extract_variable_dependencies_cached(registry, term_id, visiting));
            }
            combined
        }
        Some(ExprKind::Constant) | Some(ExprKind::Zero) => HashSet::new(),
    };

    visiting.remove(&id);
    registry.cache_sparsity(id, deps.clone());
    deps
}

pub fn estimate_nnz_cached(
    registry: &mut ExprRegistry,
    id: ExprId,
    visiting: &mut HashSet<ExprId>,
) -> usize {
    if registry.is_zero(id) {
        return 0;
    }

    if let Some(cached) = registry.get_cached_nnz_estimate(id) {
        return cached;
    }

    if visiting.contains(&id) {
        return 1;
    }
    visiting.insert(id);

    let kind_snapshot = registry.get(id).cloned();

    let estimate = match kind_snapshot {
        None => 0,
        Some(ExprKind::Variable(_)) => 1,
        Some(ExprKind::Constant) | Some(ExprKind::Zero) => 0,
        Some(ExprKind::Add(terms)) => {
            let mut total = 0;
            for term_id in terms {
                total += estimate_nnz_cached(registry, term_id, visiting);
            }
            total
        }
        Some(ExprKind::Mul(terms)) => {
            let mut product = 1usize;
            for term_id in terms {
                let child_est = estimate_nnz_cached(registry, term_id, visiting).max(1);
                product = product.saturating_mul(child_est);
                if product > 1_000_000 {
                    break;
                }
            }
            product
        }
    };

    visiting.remove(&id);
    registry.cache_nnz_estimate(id, estimate);
    estimate
}

fn extract_index_from_var(name: &str) -> Option<usize> {
    let start = name.find('[')?;
    let end = name.find(']')?;
    let inner = &name[start + 1..end];
    inner.parse().ok()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SymbolicExpression {
    Matrix(SymbolicMatrix),
    Vector(SymbolicVector),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_registry_dedup() {
        let mut reg = ExprRegistry::new();
        let id1 = reg.variable("x[0]");
        let id2 = reg.variable("x[0]");
        assert_eq!(id1, id2, "Same variable should get same ID");

        let id3 = reg.variable("x[1]");
        assert_ne!(id1, id3, "Different variables should get different IDs");
    }

    #[test]
    fn test_add_dedup() {
        let mut reg = ExprRegistry::new();
        let a = reg.variable("a");
        let b = reg.variable("b");
        let sum1 = reg.add(vec![a, b]);
        let sum2 = reg.add(vec![b, a]);
        assert_eq!(sum1, sum2, "Add with same terms (different order) should dedup");
    }

    #[test]
    fn test_mul_zero() {
        let mut reg = ExprRegistry::new();
        let a = reg.variable("a");
        let z = reg.zero();
        let product = reg.mul(vec![a, z]);
        assert!(reg.is_zero(product), "Mul with zero should return zero");
    }

    #[test]
    fn test_symbolic_multiplication() {
        let mut a = SymbolicMatrix::new(2, 3);
        a.elements.insert((0, 0), a.registry.variable("a"));
        a.elements.insert((0, 1), a.registry.variable("b"));
        a.elements.insert((1, 2), a.registry.variable("c"));

        let mut b = SymbolicMatrix::new(3, 2);
        b.elements.insert((0, 0), b.registry.variable("d"));
        b.elements.insert((1, 1), b.registry.variable("e"));
        b.elements.insert((2, 0), b.registry.variable("f"));

        let c = a.multiply(&b).unwrap();
        assert_eq!(c.rows, 2);
        assert_eq!(c.cols, 2);
        assert!(c.elements.contains_key(&(0, 0)));
        assert!(c.elements.contains_key(&(0, 1)));
        assert!(c.elements.contains_key(&(1, 0)));
    }

    #[test]
    fn test_cycle_detection() {
        let mut reg = ExprRegistry::new();
        let a = reg.variable("x[0]");
        let b = reg.variable("x[1]");
        let sum = reg.add(vec![a, b]);

        let mut visiting = HashSet::new();
        let deps = extract_variable_dependencies_cached(&mut reg, sum, &mut visiting);
        assert!(deps.contains(&0));
        assert!(deps.contains(&1));
    }

    #[test]
    fn test_nnz_estimate() {
        let mut reg = ExprRegistry::new();
        let a = reg.variable("x[0]");
        let b = reg.variable("x[1]");
        let sum = reg.add(vec![a, b]);

        let mut visiting = HashSet::new();
        let est = estimate_nnz_cached(&mut reg, sum, &mut visiting);
        assert_eq!(est, 2);
    }
}
