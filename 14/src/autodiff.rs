use crate::formats::{CooMatrix, SparseError};
use crate::symbolic::{
    SymbolicMatrix, SymbolicVector, symbolic_matrix_vector_mul,
    extract_variable_dependencies_cached, estimate_nnz_cached,
};
use serde::{Serialize, Deserialize};
use std::collections::{HashMap, HashSet};

const EXPLOSION_THRESHOLD: usize = 1_000_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SparsityPattern {
    pub rows: usize,
    pub cols: usize,
    pub positions: HashSet<(usize, usize)>,
    pub description: Option<String>,
    pub is_approximate: bool,
}

impl SparsityPattern {
    pub fn new(rows: usize, cols: usize) -> Self {
        SparsityPattern {
            rows,
            cols,
            positions: HashSet::new(),
            description: None,
            is_approximate: false,
        }
    }

    pub fn from_symbolic_matrix(matrix: &SymbolicMatrix) -> Self {
        SparsityPattern {
            rows: matrix.rows,
            cols: matrix.cols,
            positions: matrix.sparsity_pattern(),
            description: None,
            is_approximate: false,
        }
    }

    pub fn nnz(&self) -> usize {
        self.positions.len()
    }

    pub fn density(&self) -> f64 {
        if self.rows * self.cols == 0 {
            0.0
        } else {
            self.nnz() as f64 / (self.rows * self.cols) as f64
        }
    }

    pub fn transpose(&self) -> SparsityPattern {
        let mut positions = HashSet::new();
        for &(r, c) in &self.positions {
            positions.insert((c, r));
        }
        SparsityPattern {
            rows: self.cols,
            cols: self.rows,
            positions,
            description: self.description.clone(),
            is_approximate: self.is_approximate,
        }
    }

    pub fn union(&self, other: &SparsityPattern) -> Result<SparsityPattern, SparseError> {
        if self.rows != other.rows || self.cols != other.cols {
            return Err(SparseError::InvalidDimensions);
        }
        let mut positions = self.positions.clone();
        positions.extend(&other.positions);
        Ok(SparsityPattern {
            rows: self.rows,
            cols: self.cols,
            positions,
            description: None,
            is_approximate: self.is_approximate || other.is_approximate,
        })
    }

    pub fn intersection(&self, other: &SparsityPattern) -> Result<SparsityPattern, SparseError> {
        if self.rows != other.rows || self.cols != other.cols {
            return Err(SparseError::InvalidDimensions);
        }
        let positions: HashSet<_> = self.positions.intersection(&other.positions).cloned().collect();
        Ok(SparsityPattern {
            rows: self.rows,
            cols: self.cols,
            positions,
            description: None,
            is_approximate: self.is_approximate || other.is_approximate,
        })
    }
}

pub enum Expr {
    Variable(usize),
    Constant,
    Add(Vec<Expr>),
    Mul(Vec<Expr>),
    MatrixVecMul(Box<Expr>, Box<Expr>),
    MatrixMul(Box<Expr>, Box<Expr>),
}

pub enum FunctionType {
    Linear(HashMap<usize, HashSet<usize>>),
    Nonlinear,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompositeFunction {
    pub input_size: usize,
    pub layers: Vec<CompositeLayer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CompositeLayer {
    MatrixMul { rows: usize, cols: usize, positions: HashSet<(usize, usize)> },
    Elementwise { size: usize, deps: HashMap<usize, HashSet<usize>> },
}

impl CompositeFunction {
    pub fn new(input_size: usize) -> Self {
        CompositeFunction {
            input_size,
            layers: Vec::new(),
        }
    }

    pub fn add_matrix_layer(&mut self, rows: usize, cols: usize, positions: HashSet<(usize, usize)>) {
        self.layers.push(CompositeLayer::MatrixMul { rows, cols, positions });
    }

    pub fn add_elementwise_layer(&mut self, size: usize, deps: HashMap<usize, HashSet<usize>>) {
        self.layers.push(CompositeLayer::Elementwise { size, deps });
    }

    pub fn jacobian_sparsity(&self) -> SparsityPattern {
        let mut current_deps: HashMap<usize, HashSet<usize>> = HashMap::new();
        for i in 0..self.input_size {
            current_deps.insert(i, HashSet::from([i]));
        }

        let mut current_size = self.input_size;

        for layer in &self.layers {
            match layer {
                CompositeLayer::MatrixMul { rows, cols: _, positions } => {
                    let mut matrix_deps: HashMap<usize, HashSet<usize>> = HashMap::new();
                    for &(r, c) in positions {
                        matrix_deps.entry(r).or_default().insert(c);
                    }

                    let mut new_deps: HashMap<usize, HashSet<usize>> = HashMap::new();
                    for out_row in 0..*rows {
                        let mut combined = HashSet::new();
                        if let Some(col_deps) = matrix_deps.get(&out_row) {
                            for &c in col_deps {
                                if let Some(input_deps) = current_deps.get(&c) {
                                    combined.extend(input_deps);
                                }
                            }
                        }
                        new_deps.insert(out_row, combined);
                    }
                    current_deps = new_deps;
                    current_size = *rows;
                }
                CompositeLayer::Elementwise { size, deps } => {
                    let mut new_deps: HashMap<usize, HashSet<usize>> = HashMap::new();
                    for (&out_idx, input_indices) in deps {
                        let mut combined = HashSet::new();
                        for &in_idx in input_indices {
                            if let Some(input_deps) = current_deps.get(&in_idx) {
                                combined.extend(input_deps);
                            }
                        }
                        new_deps.insert(out_idx, combined);
                    }
                    current_deps = new_deps;
                    current_size = *size;
                }
            }
        }

        let output_size = current_size;
        let mut pattern = SparsityPattern::new(output_size, self.input_size);
        for (&output_idx, inputs) in &current_deps {
            for &input_idx in inputs {
                pattern.positions.insert((output_idx, input_idx));
            }
        }
        pattern.description = Some("Jacobian sparsity for composite function".to_string());
        pattern
    }

    pub fn hessian_sparsity(&self) -> SparsityPattern {
        let jac = self.jacobian_sparsity();

        let mut jacobian_deps: HashMap<usize, HashSet<usize>> = HashMap::new();
        for &(r, c) in &jac.positions {
            jacobian_deps.entry(r).or_default().insert(c);
        }

        let mut hessian_positions: HashSet<(usize, usize)> = HashSet::new();
        let mut total_estimate: usize = 0;

        for (_, inputs) in &jacobian_deps {
            let n = inputs.len();
            total_estimate = total_estimate.saturating_add(n * n);
            if total_estimate > EXPLOSION_THRESHOLD {
                return self.hessian_sparsity_approximate(&jacobian_deps);
            }
        }

        for (_, inputs) in &jacobian_deps {
            for &i in inputs {
                for &j in inputs {
                    hessian_positions.insert((i, j));
                    hessian_positions.insert((j, i));
                }
            }
        }

        let mut pattern = SparsityPattern::new(self.input_size, self.input_size);
        pattern.positions = hessian_positions;
        pattern.description = Some("Hessian sparsity pattern (symmetric)".to_string());
        pattern
    }

    fn hessian_sparsity_approximate(&self, jacobian_deps: &HashMap<usize, HashSet<usize>>) -> SparsityPattern {
        let mut row_union: HashSet<usize> = HashSet::new();
        for inputs in jacobian_deps.values() {
            row_union.extend(inputs);
        }

        let mut pattern = SparsityPattern::new(self.input_size, self.input_size);
        for &i in &row_union {
            for &j in &row_union {
                if i == j || row_union.contains(&j) {
                    pattern.positions.insert((i, j));
                }
            }
        }

        pattern.description = Some(
            "Hessian sparsity pattern (approximate - union-of-rows due to explosion risk)".to_string(),
        );
        pattern.is_approximate = true;
        pattern
    }
}

pub fn jacobian_sparsity(
    input_size: usize,
    output_size: usize,
    dependencies: &HashMap<usize, HashSet<usize>>,
) -> SparsityPattern {
    let mut pattern = SparsityPattern::new(output_size, input_size);
    for (&output_idx, inputs) in dependencies {
        for &input_idx in inputs {
            pattern.positions.insert((output_idx, input_idx));
        }
    }
    pattern.description = Some("Jacobian sparsity pattern".to_string());
    pattern
}

pub fn hessian_sparsity(
    input_size: usize,
    hessian_deps: &HashMap<(usize, usize), HashSet<(usize, usize)>>,
) -> SparsityPattern {
    let mut total_estimate: usize = 0;
    for deps in hessian_deps.values() {
        let n = deps.len();
        total_estimate = total_estimate.saturating_add(n.saturating_mul(n));
        if total_estimate > EXPLOSION_THRESHOLD {
            return hessian_sparsity_approximate_direct(input_size);
        }
    }

    let mut pattern = SparsityPattern::new(input_size, input_size);
    for &(i, j) in hessian_deps.keys() {
        pattern.positions.insert((i, j));
        pattern.positions.insert((j, i));
    }
    pattern.description = Some("Hessian sparsity pattern (symmetric)".to_string());
    pattern
}

fn hessian_sparsity_approximate_direct(input_size: usize) -> SparsityPattern {
    let mut pattern = SparsityPattern::new(input_size, input_size);
    pattern.description = Some(
        "Hessian sparsity pattern (approximate - dense fallback due to explosion risk)".to_string(),
    );
    pattern.is_approximate = true;

    let max_fill = EXPLOSION_THRESHOLD.min(input_size * input_size);
    let approx_nnz_per_row = (max_fill / input_size.max(1)).max(1);

    for i in 0..input_size {
        for j in 0..input_size {
            if (i as isize - j as isize).abs() <= approx_nnz_per_row as isize / 2 {
                pattern.positions.insert((i, j));
            }
            if pattern.positions.len() >= max_fill {
                break;
            }
        }
        if pattern.positions.len() >= max_fill {
            break;
        }
    }

    pattern
}

pub fn jacobian_sparsity_from_matrix(matrix: &CooMatrix) -> SparsityPattern {
    let mut pattern = SparsityPattern::new(matrix.rows, matrix.cols);
    for i in 0..matrix.nnz() {
        pattern.positions.insert((matrix.row_indices[i], matrix.col_indices[i]));
    }
    pattern.description = Some("Jacobian sparsity from matrix pattern".to_string());
    pattern
}

pub fn symbolic_jacobian_sparsity(
    matrix: &SymbolicMatrix,
    input_size: usize,
) -> Result<SparsityPattern, SparseError> {
    let x = SymbolicVector::from_variables(input_size, "x");
    let y = symbolic_matrix_vector_mul(matrix, &x)?;

    let mut registry = y.registry.clone();
    let mut pattern = SparsityPattern::new(y.size, input_size);

    for (&output_idx, &expr_id) in &y.elements {
        let mut visiting = HashSet::new();
        let deps = extract_variable_dependencies_cached(&mut registry, expr_id, &mut visiting);
        for dep in deps {
            pattern.positions.insert((output_idx, dep));
        }
    }

    pattern.description = Some("Symbolic Jacobian sparsity pattern".to_string());
    Ok(pattern)
}

pub fn symbolic_hessian_sparsity(
    matrix: &mut SymbolicMatrix,
    input_size: usize,
) -> Result<SparsityPattern, SparseError> {
    let non_zero_elements: Vec<((usize, usize), crate::symbolic::ExprId)> = matrix
        .elements
        .iter()
        .filter(|(_, &id)| !matrix.registry.is_zero(id))
        .map(|(&pos, &id)| (pos, id))
        .collect();

    let mut total_nnz_estimate: usize = 0;
    let mut element_deps: HashMap<(usize, usize), HashSet<usize>> = HashMap::new();

    for ((r, c), expr_id) in &non_zero_elements {
        let mut visiting = HashSet::new();
        let est = estimate_nnz_cached(&mut matrix.registry, *expr_id, &mut visiting);
        total_nnz_estimate = total_nnz_estimate.saturating_add(est.saturating_mul(est));
        if total_nnz_estimate > EXPLOSION_THRESHOLD {
            return symbolic_hessian_sparsity_approximate(matrix, input_size);
        }

        let mut visiting2 = HashSet::new();
        let deps = extract_variable_dependencies_cached(&mut matrix.registry, *expr_id, &mut visiting2);
        element_deps.insert((*r, *c), deps);
    }

    let mut pattern = SparsityPattern::new(input_size, input_size);
    let mut hessian_positions: HashSet<(usize, usize)> = HashSet::new();

    for (_, deps) in &element_deps {
        let dep_vec: Vec<_> = deps.iter().cloned().collect();
        for &i in &dep_vec {
            for &j in &dep_vec {
                hessian_positions.insert((i, j));
            }
        }
        if hessian_positions.len() > EXPLOSION_THRESHOLD {
            return symbolic_hessian_sparsity_approximate(matrix, input_size);
        }
    }

    pattern.positions = hessian_positions;
    pattern.description = Some("Symbolic Hessian sparsity pattern (symmetric)".to_string());
    Ok(pattern)
}

fn symbolic_hessian_sparsity_approximate(
    matrix: &SymbolicMatrix,
    input_size: usize,
) -> Result<SparsityPattern, SparseError> {
    let mut row_dep_union: HashSet<usize> = HashSet::new();
    let mut registry = matrix.registry.clone();

    for (&(_, _), &expr_id) in &matrix.elements {
        if registry.is_zero(expr_id) {
            continue;
        }
        let mut visiting = HashSet::new();
        let deps = extract_variable_dependencies_cached(&mut registry, expr_id, &mut visiting);
        row_dep_union.extend(deps);
    }

    let mut pattern = SparsityPattern::new(input_size, input_size);
    let dep_vec: Vec<_> = row_dep_union.iter().cloned().collect();
    for &i in &dep_vec {
        for &j in &dep_vec {
            pattern.positions.insert((i, j));
        }
    }

    pattern.description = Some(
        "Symbolic Hessian sparsity pattern (approximate - union-of-rows due to explosion risk)".to_string(),
    );
    pattern.is_approximate = true;
    Ok(pattern)
}

pub fn compute_bipartite_graph(pattern: &SparsityPattern) -> (Vec<usize>, Vec<(usize, usize)>) {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    for r in 0..pattern.rows {
        nodes.push(r);
    }
    for c in 0..pattern.cols {
        nodes.push(pattern.rows + c);
    }

    for &(r, c) in &pattern.positions {
        edges.push((r, pattern.rows + c));
    }

    (nodes, edges)
}

pub fn estimate_coloring(pattern: &SparsityPattern) -> usize {
    let mut max_degree = 0;
    let mut col_degree = vec![0; pattern.cols];

    for &(_, c) in &pattern.positions {
        col_degree[c] += 1;
        max_degree = max_degree.max(col_degree[c]);
    }

    max_degree
}

pub fn check_explosion_risk(matrix: &SymbolicMatrix) -> ExplosionRiskReport {
    let mut registry = matrix.registry.clone();
    let mut report = ExplosionRiskReport {
        total_nnz_estimate: 0,
        max_element_nnz: 0,
        is_safe: true,
        risk_level: RiskLevel::Low,
    };

    for (&(_, _), &expr_id) in &matrix.elements {
        if registry.is_zero(expr_id) {
            continue;
        }
        let mut visiting = HashSet::new();
        let est = estimate_nnz_cached(&mut registry, expr_id, &mut visiting);
        report.max_element_nnz = report.max_element_nnz.max(est);
        report.total_nnz_estimate = report.total_nnz_estimate.saturating_add(est);
    }

    if report.total_nnz_estimate > EXPLOSION_THRESHOLD {
        report.is_safe = false;
        report.risk_level = RiskLevel::Critical;
    } else if report.total_nnz_estimate > EXPLOSION_THRESHOLD / 10 {
        report.risk_level = RiskLevel::High;
    } else if report.total_nnz_estimate > EXPLOSION_THRESHOLD / 100 {
        report.risk_level = RiskLevel::Medium;
    }

    report
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExplosionRiskReport {
    pub total_nnz_estimate: usize,
    pub max_element_nnz: usize,
    pub is_safe: bool,
    pub risk_level: RiskLevel,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formats::CooMatrix;

    #[test]
    fn test_jacobian_sparsity() {
        let mut deps = HashMap::new();
        deps.insert(0, [0, 1].iter().cloned().collect());
        deps.insert(1, [1, 2].iter().cloned().collect());
        deps.insert(2, [2, 0].iter().cloned().collect());

        let pattern = jacobian_sparsity(3, 3, &deps);
        assert_eq!(pattern.nnz(), 6);
        assert!(pattern.positions.contains(&(0, 0)));
        assert!(pattern.positions.contains(&(0, 1)));
        assert!(pattern.positions.contains(&(1, 1)));
    }

    #[test]
    fn test_hessian_sparsity() {
        let mut deps = HashMap::new();
        deps.insert((0, 1), HashSet::new());
        deps.insert((1, 2), HashSet::new());

        let pattern = hessian_sparsity(3, &deps);
        assert!(pattern.positions.contains(&(0, 1)));
        assert!(pattern.positions.contains(&(1, 0)));
        assert!(pattern.positions.contains(&(1, 2)));
        assert!(pattern.positions.contains(&(2, 1)));
    }

    #[test]
    fn test_jacobian_from_matrix() {
        let mut coo = CooMatrix::new(2, 3);
        coo.push(0, 0, 1.0).unwrap();
        coo.push(0, 2, 2.0).unwrap();
        coo.push(1, 1, 3.0).unwrap();

        let pattern = jacobian_sparsity_from_matrix(&coo);
        assert_eq!(pattern.nnz(), 3);
        assert!(pattern.positions.contains(&(0, 0)));
        assert!(pattern.positions.contains(&(0, 2)));
        assert!(pattern.positions.contains(&(1, 1)));
    }

    #[test]
    fn test_composite_jacobian() {
        let mut func = CompositeFunction::new(3);

        let mut positions = HashSet::new();
        positions.insert((0, 0));
        positions.insert((0, 1));
        positions.insert((1, 1));
        positions.insert((1, 2));
        positions.insert((2, 2));
        positions.insert((2, 0));
        func.add_matrix_layer(3, 3, positions);

        let jac = func.jacobian_sparsity();
        assert!(jac.positions.contains(&(0, 0)));
        assert!(jac.positions.contains(&(0, 1)));
        assert!(jac.positions.contains(&(2, 0)));
        assert!(jac.positions.contains(&(2, 2)));
        assert!(!jac.positions.contains(&(0, 2)));
    }

    #[test]
    fn test_composite_hessian() {
        let mut func = CompositeFunction::new(3);

        let mut positions = HashSet::new();
        positions.insert((0, 0));
        positions.insert((0, 1));
        positions.insert((1, 1));
        positions.insert((1, 2));
        func.add_matrix_layer(2, 3, positions);

        let hess = func.hessian_sparsity();
        assert!(hess.positions.contains(&(0, 1)));
        assert!(!hess.is_approximate);
    }

    #[test]
    fn test_explosion_detection() {
        let mut coo = CooMatrix::new(3, 3);
        coo.push(0, 0, 1.0).unwrap();
        coo.push(0, 1, 2.0).unwrap();
        coo.push(1, 1, 3.0).unwrap();
        coo.push(1, 2, 4.0).unwrap();
        coo.push(2, 2, 5.0).unwrap();

        let sym = SymbolicMatrix::from_coo(&coo, Some("A"));
        let report = check_explosion_risk(&sym);
        assert!(report.is_safe);
    }

    #[test]
    fn test_approximate_mode_flag() {
        let mut deps: HashMap<(usize, usize), HashSet<(usize, usize)>> = HashMap::new();
        for i in 0..2000 {
            let mut row_deps = HashSet::new();
            for j in 0..2000 {
                if (i as isize - j as isize).abs() <= 50 {
                    row_deps.insert((i, j));
                }
            }
            deps.insert((i, i), row_deps);
        }

        let pattern = hessian_sparsity(2000, &deps);
        assert!(pattern.is_approximate);
    }
}
