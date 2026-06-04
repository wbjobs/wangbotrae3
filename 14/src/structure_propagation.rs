use crate::formats::SparseError;
use crate::structure::MatrixStructure;
use serde::{Serialize, Deserialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MatrixExpr {
    Matrix {
        name: String,
        rows: usize,
        cols: usize,
        structure: MatrixStructure,
    },
    Transpose(Box<MatrixExpr>),
    Add(Box<MatrixExpr>, Box<MatrixExpr>),
    Multiply(Box<MatrixExpr>, Box<MatrixExpr>),
    Hadamard(Box<MatrixExpr>, Box<MatrixExpr>),
    Block(Vec<Vec<MatrixExpr>>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructureNode {
    pub description: String,
    pub rows: usize,
    pub cols: usize,
    pub structure: MatrixStructure,
    pub children: Vec<StructureNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructureDerivationTree {
    pub root: StructureNode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StructureConstraint {
    Symmetric,
    UpperTriangular,
    LowerTriangular,
    Diagonal,
    Banded { max_bandwidth: usize },
    Sparse { max_density: f64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConstraintViolation {
    pub step: String,
    pub constraint: StructureConstraint,
    pub actual_structure: String,
    pub suggestion: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptimizationSuggestion {
    pub location: String,
    pub suggestion_type: String,
    pub description: String,
    pub potential_benefit: String,
}

pub fn propagate_structure(expr: &MatrixExpr) -> Result<(MatrixStructure, usize, usize), SparseError> {
    match expr {
        MatrixExpr::Matrix { rows, cols, structure, .. } => {
            Ok((structure.clone(), *rows, *cols))
        }
        MatrixExpr::Transpose(inner) => {
            let (inner_struct, rows, cols) = propagate_structure(inner)?;
            let mut result = inner_struct.clone();
            std::mem::swap(&mut result.is_upper_triangular, &mut result.is_lower_triangular);
            Ok((result, cols, rows))
        }
        MatrixExpr::Add(a, b) => {
            let (sa, ra, ca) = propagate_structure(a)?;
            let (sb, rb, cb) = propagate_structure(b)?;
            
            if ra != rb || ca != cb {
                return Err(SparseError::InvalidDimensions);
            }
            
            let mut result = MatrixStructure::default();
            result.is_symmetric = sa.is_symmetric && sb.is_symmetric;
            result.is_skew_symmetric = sa.is_skew_symmetric && sb.is_skew_symmetric;
            result.is_upper_triangular = sa.is_upper_triangular && sb.is_upper_triangular;
            result.is_lower_triangular = sa.is_lower_triangular && sb.is_lower_triangular;
            result.is_diagonal = sa.is_diagonal && sb.is_diagonal;
            result.is_identity = sa.is_identity && sb.is_identity;
            result.is_permutation = sa.is_permutation && sb.is_permutation;
            result.sparsity_ratio = sa.sparsity_ratio.max(sb.sparsity_ratio);
            
            match (sa.band_width, sb.band_width) {
                (Some(bwa), Some(bwb)) => {
                    result.band_width = Some(bwa.max(bwb));
                    result.is_banded = result.band_width.unwrap() <= ra / 4;
                }
                _ => {
                    result.band_width = None;
                    result.is_banded = false;
                }
            }
            
            Ok((result, ra, ca))
        }
        MatrixExpr::Multiply(a, b) => {
            let (sa, ra, ca) = propagate_structure(a)?;
            let (sb, rb, cb) = propagate_structure(b)?;
            
            if ca != rb {
                return Err(SparseError::InvalidDimensions);
            }
            
            let mut result = MatrixStructure::default();
            
            result.is_diagonal = sa.is_diagonal && sb.is_diagonal;
            result.is_identity = sa.is_identity && sb.is_identity;
            result.is_permutation = sa.is_permutation && sb.is_permutation;
            
            if result.is_diagonal {
                result.is_symmetric = true;
                result.is_upper_triangular = true;
                result.is_lower_triangular = true;
                result.is_banded = true;
                result.band_width = Some(0);
            } else {
                result.is_upper_triangular = sa.is_upper_triangular && sb.is_upper_triangular;
                result.is_lower_triangular = sa.is_lower_triangular && sb.is_lower_triangular;
                result.is_symmetric = (sa.is_symmetric && sb.is_symmetric) && 
                                      (sa.is_diagonal || sb.is_diagonal);
                result.is_banded = sa.is_banded && sb.is_banded;
                
                if let (Some(bwa), Some(bwb)) = (sa.band_width, sb.band_width) {
                    result.band_width = Some(bwa + bwb);
                } else {
                    result.band_width = None;
                }
            }
            
            result.sparsity_ratio = estimate_sparsity_product(&sa, &sb, ra, ca, cb);
            
            Ok((result, ra, cb))
        }
        MatrixExpr::Hadamard(a, b) => {
            let (sa, ra, ca) = propagate_structure(a)?;
            let (sb, rb, cb) = propagate_structure(b)?;
            
            if ra != rb || ca != cb {
                return Err(SparseError::InvalidDimensions);
            }
            
            let mut result = MatrixStructure::default();
            result.is_symmetric = sa.is_symmetric && sb.is_symmetric;
            result.is_upper_triangular = sa.is_upper_triangular || sb.is_upper_triangular;
            result.is_lower_triangular = sa.is_lower_triangular || sb.is_lower_triangular;
            result.is_diagonal = sa.is_diagonal || sb.is_diagonal;
            result.sparsity_ratio = sa.sparsity_ratio * sb.sparsity_ratio;
            
            if result.is_diagonal {
                result.is_banded = true;
                result.band_width = Some(0);
            }
            
            Ok((result, ra, ca))
        }
        MatrixExpr::Block(blocks) => {
            if blocks.is_empty() {
                return Err(SparseError::InvalidDimensions);
            }
            
            let block_rows = blocks.len();
            let block_cols = blocks[0].len();
            
            let mut total_rows = 0;
            let mut total_cols = 0;
            let mut col_sizes = vec![0; block_cols];
            
            for (row_idx, row) in blocks.iter().enumerate() {
                if row.len() != block_cols {
                    return Err(SparseError::InvalidDimensions);
                }
                
                let mut row_height = None;
                for (col_idx, block) in row.iter().enumerate() {
                    let (_, br, bc) = propagate_structure(block)?;
                    
                    match row_height {
                        None => row_height = Some(br),
                        Some(h) if h != br => return Err(SparseError::InvalidDimensions),
                        _ => {}
                    }
                    
                    if row_idx == 0 {
                        col_sizes[col_idx] = bc;
                    } else if col_sizes[col_idx] != bc {
                        return Err(SparseError::InvalidDimensions);
                    }
                }
                
                total_rows += row_height.unwrap_or(0);
            }
            
            total_cols = col_sizes.iter().sum();
            
            let mut result = MatrixStructure::default();
            result.sparsity_ratio = 0.5;
            
            let is_block_diagonal = {
                let mut diag = true;
                for (i, row) in blocks.iter().enumerate() {
                    for (j, _) in row.iter().enumerate() {
                        if i != j {
                            if let MatrixExpr::Matrix { structure, .. } = &blocks[i][j] {
                                if structure.sparsity_ratio > 0.0 {
                                    diag = false;
                                    break;
                                }
                            } else {
                                diag = false;
                                break;
                            }
                        }
                    }
                }
                diag
            };
            
            if is_block_diagonal {
                result.is_symmetric = blocks.iter().enumerate().all(|(i, row)| {
                    row[i].clone().structure().map_or(false, |s| s.is_symmetric)
                });
                result.sparsity_ratio = 1.0 / block_rows as f64;
            }
            
            Ok((result, total_rows, total_cols))
        }
    }
}

fn estimate_sparsity_product(sa: &MatrixStructure, sb: &MatrixStructure, 
                              m: usize, k: usize, n: usize) -> f64 {
    let da = sa.sparsity_ratio;
    let db = sb.sparsity_ratio;
    
    if sa.is_diagonal || sb.is_diagonal {
        return da.max(db);
    }
    
    let theoretical = 1.0 - (1.0 - da * db).powi(k as i32);
    let upper_bound = (da * k as f64).min(1.0) * (db * k as f64).min(1.0) / k as f64;
    
    theoretical.min(upper_bound).min(1.0).max(da.max(db))
}

pub fn build_derivation_tree(expr: &MatrixExpr) -> Result<StructureDerivationTree, SparseError> {
    let root = build_derivation_node(expr)?;
    Ok(StructureDerivationTree { root })
}

fn build_derivation_node(expr: &MatrixExpr) -> Result<StructureNode, SparseError> {
    match expr {
        MatrixExpr::Matrix { name, rows, cols, structure } => {
            Ok(StructureNode {
                description: format!("Matrix {}", name),
                rows: *rows,
                cols: *cols,
                structure: structure.clone(),
                children: Vec::new(),
            })
        }
        MatrixExpr::Transpose(inner) => {
            let child = build_derivation_node(inner)?;
            let (structure, rows, cols) = propagate_structure(expr)?;
            Ok(StructureNode {
                description: "Transpose".to_string(),
                rows,
                cols,
                structure,
                children: vec![child],
            })
        }
        MatrixExpr::Add(a, b) => {
            let child_a = build_derivation_node(a)?;
            let child_b = build_derivation_node(b)?;
            let (structure, rows, cols) = propagate_structure(expr)?;
            Ok(StructureNode {
                description: "Addition".to_string(),
                rows,
                cols,
                structure,
                children: vec![child_a, child_b],
            })
        }
        MatrixExpr::Multiply(a, b) => {
            let child_a = build_derivation_node(a)?;
            let child_b = build_derivation_node(b)?;
            let (structure, rows, cols) = propagate_structure(expr)?;
            Ok(StructureNode {
                description: "Multiplication".to_string(),
                rows,
                cols,
                structure,
                children: vec![child_a, child_b],
            })
        }
        MatrixExpr::Hadamard(a, b) => {
            let child_a = build_derivation_node(a)?;
            let child_b = build_derivation_node(b)?;
            let (structure, rows, cols) = propagate_structure(expr)?;
            Ok(StructureNode {
                description: "Hadamard Product".to_string(),
                rows,
                cols,
                structure,
                children: vec![child_a, child_b],
            })
        }
        MatrixExpr::Block(blocks) => {
            let mut children = Vec::new();
            for (i, row) in blocks.iter().enumerate() {
                for (j, block) in row.iter().enumerate() {
                    let mut child = build_derivation_node(block)?;
                    child.description = format!("Block[{},{}]: {}", i, j, child.description);
                    children.push(child);
                }
            }
            let (structure, rows, cols) = propagate_structure(expr)?;
            Ok(StructureNode {
                description: format!("Block Matrix ({}x{} blocks)", blocks.len(), blocks[0].len()),
                rows,
                cols,
                structure,
                children,
            })
        }
    }
}

pub fn verify_constraints(expr: &MatrixExpr, 
                           constraints: &[StructureConstraint]) 
                           -> Result<Vec<ConstraintViolation>, SparseError> {
    let mut violations = Vec::new();
    let (final_struct, _, _) = propagate_structure(expr)?;
    let tree = build_derivation_tree(expr)?;
    
    for constraint in constraints {
        let violated = !check_constraint(&final_struct, constraint);
        if violated {
            let suggestion = find_violation_source(&tree.root, constraint);
            violations.push(ConstraintViolation {
                step: "Final result".to_string(),
                constraint: constraint.clone(),
                actual_structure: format_structure(&final_struct),
                suggestion,
            });
        }
    }
    
    Ok(violations)
}

fn check_constraint(s: &MatrixStructure, c: &StructureConstraint) -> bool {
    match c {
        StructureConstraint::Symmetric => s.is_symmetric,
        StructureConstraint::UpperTriangular => s.is_upper_triangular,
        StructureConstraint::LowerTriangular => s.is_lower_triangular,
        StructureConstraint::Diagonal => s.is_diagonal,
        StructureConstraint::Banded { max_bandwidth } => {
            s.is_banded && s.band_width.map_or(false, |b| b <= *max_bandwidth)
        }
        StructureConstraint::Sparse { max_density } => s.sparsity_ratio <= *max_density,
    }
}

fn find_violation_source(node: &StructureNode, 
                          constraint: &StructureConstraint) -> Option<String> {
    if !check_constraint(&node.structure, constraint) {
        if node.children.is_empty() {
            return Some(format!("Violation originates at: {}", node.description));
        }
        for child in &node.children {
            if let Some(src) = find_violation_source(child, constraint) {
                return Some(src);
            }
        }
        return Some(format!("Violation introduced at: {}", node.description));
    }
    None
}

pub fn generate_suggestions(expr: &MatrixExpr) -> Result<Vec<OptimizationSuggestion>, SparseError> {
    let mut suggestions = Vec::new();
    collect_suggestions(expr, &mut suggestions)?;
    Ok(suggestions)
}

fn collect_suggestions(expr: &MatrixExpr, 
                        suggestions: &mut Vec<OptimizationSuggestion>) 
                        -> Result<(), SparseError> {
    match expr {
        MatrixExpr::Multiply(a, b) => {
            let (sa, _, _) = propagate_structure(a)?;
            let (sb, _, _) = propagate_structure(b)?;
            
            if sa.is_symmetric {
                suggestions.push(OptimizationSuggestion {
                    location: "Left operand".to_string(),
                    suggestion_type: "Storage Optimization".to_string(),
                    description: "Symmetric matrix detected: use symmetric storage format to halve memory usage".to_string(),
                    potential_benefit: "50% memory reduction, potentially faster multiplication".to_string(),
                });
            }
            
            if sb.is_symmetric {
                suggestions.push(OptimizationSuggestion {
                    location: "Right operand".to_string(),
                    suggestion_type: "Storage Optimization".to_string(),
                    description: "Symmetric matrix detected: use symmetric storage format".to_string(),
                    potential_benefit: "50% memory reduction".to_string(),
                });
            }
            
            if sa.is_diagonal {
                suggestions.push(OptimizationSuggestion {
                    location: "Left operand".to_string(),
                    suggestion_type: "Algorithm Optimization".to_string(),
                    description: "Diagonal matrix multiplication: O(n) instead of O(n³)".to_string(),
                    potential_benefit: "Dramatic speedup, especially for large matrices".to_string(),
                });
            }
            
            if sb.is_diagonal {
                suggestions.push(OptimizationSuggestion {
                    location: "Right operand".to_string(),
                    suggestion_type: "Algorithm Optimization".to_string(),
                    description: "Diagonal matrix multiplication can be optimized".to_string(),
                    potential_benefit: "Dramatic speedup".to_string(),
                });
            }
            
            if sa.is_banded && sb.is_banded {
                if let (Some(bwa), Some(bwb)) = (sa.band_width, sb.band_width) {
                    suggestions.push(OptimizationSuggestion {
                        location: "Both operands".to_string(),
                        suggestion_type: "Band Matrix Optimization".to_string(),
                        description: format!(
                            "Band matrices detected (bw={}, bw={}): use band matrix multiplication",
                            bwa, bwb
                        ),
                        potential_benefit: "O(n*bw²) complexity instead of O(n³)".to_string(),
                    });
                }
            }
            
            collect_suggestions(a, suggestions)?;
            collect_suggestions(b, suggestions)?;
        }
        MatrixExpr::Add(a, b) => {
            let (sa, _, _) = propagate_structure(a)?;
            let (sb, _, _) = propagate_structure(b)?;
            
            if sa.is_upper_triangular && sb.is_upper_triangular {
                suggestions.push(OptimizationSuggestion {
                    location: "Addition operands".to_string(),
                    suggestion_type: "Sparsity Preserving".to_string(),
                    description: "Sum of two upper triangular matrices preserves triangular structure".to_string(),
                    potential_benefit: "Result will also be upper triangular, can use optimized storage".to_string(),
                });
            }
            
            collect_suggestions(a, suggestions)?;
            collect_suggestions(b, suggestions)?;
        }
        MatrixExpr::Transpose(inner) => {
            let (s, _, _) = propagate_structure(inner)?;
            if s.is_symmetric {
                suggestions.push(OptimizationSuggestion {
                    location: "Transpose operand".to_string(),
                    suggestion_type: "Redundant Operation".to_string(),
                    description: "Transposing a symmetric matrix is a no-op - consider removing this operation".to_string(),
                    potential_benefit: "Eliminate unnecessary computation and memory copy".to_string(),
                });
            }
            collect_suggestions(inner, suggestions)?;
        }
        MatrixExpr::Block(blocks) => {
            if blocks.len() == blocks[0].len() {
                let is_block_diagonal = blocks.iter().enumerate().all(|(i, row)| {
                    row.iter().enumerate().all(|(j, _)| {
                        if i == j { true } else {
                            if let MatrixExpr::Matrix { structure, .. } = &blocks[i][j] {
                                structure.sparsity_ratio == 0.0
                            } else {
                                false
                            }
                        }
                    })
                });
                
                if is_block_diagonal {
                    suggestions.push(OptimizationSuggestion {
                        location: "Block matrix structure".to_string(),
                        suggestion_type: "Block Structure Optimization".to_string(),
                        description: "Block diagonal structure detected: use block diagonal algorithms".to_string(),
                        potential_benefit: "Parallelizable operations, reduced memory overhead".to_string(),
                    });
                }
            }
            
            for row in blocks {
                for block in row {
                    collect_suggestions(block, suggestions)?;
                }
            }
        }
        MatrixExpr::Hadamard(a, b) => {
            collect_suggestions(a, suggestions)?;
            collect_suggestions(b, suggestions)?;
        }
        MatrixExpr::Matrix { .. } => {}
    }
    Ok(())
}

pub fn format_structure(s: &MatrixStructure) -> String {
    let mut props = Vec::new();
    if s.is_symmetric { props.push("symmetric".to_string()); }
    if s.is_skew_symmetric { props.push("skew-symmetric".to_string()); }
    if s.is_upper_triangular { props.push("upper triangular".to_string()); }
    if s.is_lower_triangular { props.push("lower triangular".to_string()); }
    if s.is_diagonal { props.push("diagonal".to_string()); }
    if s.is_banded { 
        if let Some(bw) = s.band_width {
            props.push(format!("banded (bw={})", bw));
        }
    }
    if s.is_identity { props.push("identity".to_string()); }
    if s.is_permutation { props.push("permutation".to_string()); }
    
    if props.is_empty() {
        format!("general (density={:.2}%)", s.sparsity_ratio * 100.0)
    } else {
        format!("{} (density={:.2}%)", props.join(", "), s.sparsity_ratio * 100.0)
    }
}

pub fn format_constraint(c: &StructureConstraint) -> String {
    match c {
        StructureConstraint::Symmetric => "should be symmetric".to_string(),
        StructureConstraint::UpperTriangular => "should be upper triangular".to_string(),
        StructureConstraint::LowerTriangular => "should be lower triangular".to_string(),
        StructureConstraint::Diagonal => "should be diagonal".to_string(),
        StructureConstraint::Banded { max_bandwidth } => 
            format!("should be banded with bandwidth ≤ {}", max_bandwidth),
        StructureConstraint::Sparse { max_density } => 
            format!("should have density ≤ {:.2}%", max_density * 100.0),
    }
}

pub fn print_derivation_tree(tree: &StructureDerivationTree) {
    print_node(&tree.root, 0);
}

fn print_node(node: &StructureNode, depth: usize) {
    let indent = "  ".repeat(depth);
    println!("{}{}: {}x{} - {}", 
        indent, 
        node.description,
        node.rows,
        node.cols,
        format_structure(&node.structure)
    );
    
    for child in &node.children {
        print_node(child, depth + 1);
    }
}

impl MatrixExpr {
    fn structure(&self) -> Result<MatrixStructure, SparseError> {
        propagate_structure(self).map(|(s, _, _)| s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::structure::MatrixStructure;

    fn diagonal_struct(n: usize) -> MatrixStructure {
        let mut s = MatrixStructure::default();
        s.is_diagonal = true;
        s.is_symmetric = true;
        s.is_upper_triangular = true;
        s.is_lower_triangular = true;
        s.is_banded = true;
        s.band_width = Some(0);
        s.sparsity_ratio = 1.0 / n as f64;
        s
    }
    
    fn upper_tri_struct(n: usize) -> MatrixStructure {
        let mut s = MatrixStructure::default();
        s.is_upper_triangular = true;
        s.sparsity_ratio = 0.5;
        s
    }
    
    fn symmetric_struct(n: usize) -> MatrixStructure {
        let mut s = MatrixStructure::default();
        s.is_symmetric = true;
        s.sparsity_ratio = 0.3;
        s
    }

    #[test]
    fn test_diagonal_multiply() {
        let a = MatrixExpr::Matrix {
            name: "A".to_string(),
            rows: 3,
            cols: 3,
            structure: diagonal_struct(3),
        };
        let b = MatrixExpr::Matrix {
            name: "B".to_string(),
            rows: 3,
            cols: 3,
            structure: diagonal_struct(3),
        };
        
        let product = MatrixExpr::Multiply(Box::new(a), Box::new(b));
        let (s, _, _) = propagate_structure(&product).unwrap();
        
        assert!(s.is_diagonal);
        assert!(s.is_symmetric);
    }

    #[test]
    fn test_transpose_symmetric() {
        let a = MatrixExpr::Matrix {
            name: "A".to_string(),
            rows: 3,
            cols: 3,
            structure: symmetric_struct(3),
        };
        
        let transposed = MatrixExpr::Transpose(Box::new(a));
        let (s, _, _) = propagate_structure(&transposed).unwrap();
        
        assert!(s.is_symmetric);
    }

    #[test]
    fn test_upper_tri_add() {
        let a = MatrixExpr::Matrix {
            name: "A".to_string(),
            rows: 3,
            cols: 3,
            structure: upper_tri_struct(3),
        };
        let b = MatrixExpr::Matrix {
            name: "B".to_string(),
            rows: 3,
            cols: 3,
            structure: upper_tri_struct(3),
        };
        
        let sum = MatrixExpr::Add(Box::new(a), Box::new(b));
        let (s, _, _) = propagate_structure(&sum).unwrap();
        
        assert!(s.is_upper_triangular);
    }

    #[test]
    fn test_constraint_verification() {
        let a = MatrixExpr::Matrix {
            name: "A".to_string(),
            rows: 3,
            cols: 3,
            structure: upper_tri_struct(3),
        };
        let b = MatrixExpr::Matrix {
            name: "B".to_string(),
            rows: 3,
            cols: 3,
            structure: upper_tri_struct(3),
        };
        
        let product = MatrixExpr::Multiply(Box::new(a), Box::new(b));
        
        let constraints = vec![StructureConstraint::UpperTriangular];
        let violations = verify_constraints(&product, &constraints).unwrap();
        
        assert!(violations.is_empty());
    }

    #[test]
    fn test_derivation_tree() {
        let a = MatrixExpr::Matrix {
            name: "A".to_string(),
            rows: 3,
            cols: 3,
            structure: diagonal_struct(3),
        };
        let b = MatrixExpr::Matrix {
            name: "B".to_string(),
            rows: 3,
            cols: 3,
            structure: diagonal_struct(3),
        };
        
        let product = MatrixExpr::Multiply(Box::new(a), Box::new(b));
        let tree = build_derivation_tree(&product).unwrap();
        
        assert_eq!(tree.root.description, "Multiplication");
        assert_eq!(tree.root.children.len(), 2);
    }

    #[test]
    fn test_suggestions_generation() {
        let a = MatrixExpr::Matrix {
            name: "A".to_string(),
            rows: 3,
            cols: 3,
            structure: symmetric_struct(3),
        };
        let b = MatrixExpr::Matrix {
            name: "B".to_string(),
            rows: 3,
            cols: 3,
            structure: diagonal_struct(3),
        };
        
        let product = MatrixExpr::Multiply(Box::new(a), Box::new(b));
        let suggestions = generate_suggestions(&product).unwrap();
        
        assert!(!suggestions.is_empty());
        assert!(suggestions.iter().any(|s| s.suggestion_type.contains("Storage")));
        assert!(suggestions.iter().any(|s| s.suggestion_type.contains("Algorithm")));
    }
}
