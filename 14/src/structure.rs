use crate::formats::{CooMatrix, CsrMatrix, CscMatrix, SparseError};
use serde::{Serialize, Deserialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatrixStructure {
    pub is_symmetric: bool,
    pub is_skew_symmetric: bool,
    pub is_upper_triangular: bool,
    pub is_lower_triangular: bool,
    pub is_diagonal: bool,
    pub is_banded: bool,
    pub band_width: Option<usize>,
    pub is_identity: bool,
    pub is_permutation: bool,
    pub is_positive_definite: Option<bool>,
    pub sparsity_ratio: f64,
}

impl Default for MatrixStructure {
    fn default() -> Self {
        MatrixStructure {
            is_symmetric: false,
            is_skew_symmetric: false,
            is_upper_triangular: false,
            is_lower_triangular: false,
            is_diagonal: false,
            is_banded: false,
            band_width: None,
            is_identity: false,
            is_permutation: false,
            is_positive_definite: None,
            sparsity_ratio: 0.0,
        }
    }
}

pub fn detect_structure(matrix: &CooMatrix) -> MatrixStructure {
    let mut result = MatrixStructure::default();
    let n = matrix.rows;
    let m = matrix.cols;
    
    result.sparsity_ratio = if n * m > 0 {
        matrix.nnz() as f64 / (n * m) as f64
    } else {
        0.0
    };

    if n != m {
        return result;
    }

    let mut elements: HashMap<(usize, usize), f64> = HashMap::new();
    let mut positions: Vec<(usize, usize)> = Vec::new();
    for i in 0..matrix.nnz() {
        let key = (matrix.row_indices[i], matrix.col_indices[i]);
        elements.insert(key, matrix.values[i]);
        positions.push(key);
    }

    let mut diag_elements: Vec<(usize, f64)> = Vec::new();
    for (&(r, c), &v) in &elements {
        if r == c {
            diag_elements.push((r, v));
        }
    }

    result.is_diagonal = elements.keys().all(|&(r, c)| r == c);

    result.is_upper_triangular = elements.keys().all(|&(r, c)| r <= c);
    result.is_lower_triangular = elements.keys().all(|&(r, c)| r >= c);

    result.is_symmetric = check_symmetric(&elements);
    result.is_skew_symmetric = check_skew_symmetric(&elements);

    let bw = calculate_bandwidth(&positions);
    result.is_banded = bw <= n / 4;
    result.band_width = Some(bw);

    result.is_identity = check_identity(&elements, n);
    result.is_permutation = check_permutation(&elements, n);
    result.is_positive_definite = if result.is_symmetric && result.is_diagonal {
        Some(diag_elements.iter().all(|&(_, v)| v > 0.0))
    } else {
        None
    };

    result
}

fn check_symmetric(elements: &HashMap<(usize, usize), f64>) -> bool {
    for (&(r, c), &v) in elements {
        if r != c {
            match elements.get(&(c, r)) {
                Some(&v2) if (v - v2).abs() < 1e-10 => continue,
                _ => return false,
            }
        }
    }
    true
}

fn check_skew_symmetric(elements: &HashMap<(usize, usize), f64>) -> bool {
    for (&(r, c), &v) in elements {
        if r == c {
            if v.abs() > 1e-10 {
                return false;
            }
        } else {
            match elements.get(&(c, r)) {
                Some(&v2) if (v + v2).abs() < 1e-10 => continue,
                _ => return false,
            }
        }
    }
    true
}

fn calculate_bandwidth(positions: &[(usize, usize)]) -> usize {
    let mut max_band = 0;
    for &(r, c) in positions {
        let band = if r >= c { r - c } else { c - r };
        max_band = max_band.max(band);
    }
    max_band
}

fn check_identity(elements: &HashMap<(usize, usize), f64>, n: usize) -> bool {
    if elements.len() != n {
        return false;
    }
    for (&(r, c), &v) in elements {
        if r != c || (v - 1.0).abs() > 1e-10 {
            return false;
        }
    }
    true
}

fn check_permutation(elements: &HashMap<(usize, usize), f64>, n: usize) -> bool {
    if elements.len() != n {
        return false;
    }
    let mut rows_seen = HashSet::new();
    let mut cols_seen = HashSet::new();
    for (&(r, c), &v) in elements {
        if (v - 1.0).abs() > 1e-10 {
            return false;
        }
        if rows_seen.contains(&r) || cols_seen.contains(&c) {
            return false;
        }
        rows_seen.insert(r);
        cols_seen.insert(c);
    }
    rows_seen.len() == n && cols_seen.len() == n
}

pub trait StructureDetect {
    fn detect_structure(&self) -> Result<MatrixStructure, SparseError>;
}

impl StructureDetect for CsrMatrix {
    fn detect_structure(&self) -> Result<MatrixStructure, SparseError> {
        Ok(detect_structure(&self.to_coo()?))
    }
}

impl StructureDetect for CscMatrix {
    fn detect_structure(&self) -> Result<MatrixStructure, SparseError> {
        Ok(detect_structure(&self.to_coo()?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formats::CooMatrix;

    #[test]
    fn test_diagonal_matrix() {
        let mut coo = CooMatrix::new(3, 3);
        coo.push(0, 0, 1.0).unwrap();
        coo.push(1, 1, 2.0).unwrap();
        coo.push(2, 2, 3.0).unwrap();
        
        let s = detect_structure(&coo);
        assert!(s.is_diagonal);
        assert!(s.is_symmetric);
        assert!(s.is_upper_triangular);
        assert!(s.is_lower_triangular);
    }

    #[test]
    fn test_identity_matrix() {
        let mut coo = CooMatrix::new(3, 3);
        coo.push(0, 0, 1.0).unwrap();
        coo.push(1, 1, 1.0).unwrap();
        coo.push(2, 2, 1.0).unwrap();
        
        let s = detect_structure(&coo);
        assert!(s.is_identity);
        assert!(s.is_permutation);
    }

    #[test]
    fn test_upper_triangular() {
        let mut coo = CooMatrix::new(3, 3);
        coo.push(0, 0, 1.0).unwrap();
        coo.push(0, 1, 2.0).unwrap();
        coo.push(1, 1, 3.0).unwrap();
        coo.push(1, 2, 4.0).unwrap();
        coo.push(2, 2, 5.0).unwrap();
        
        let s = detect_structure(&coo);
        assert!(s.is_upper_triangular);
        assert!(!s.is_lower_triangular);
    }
}
