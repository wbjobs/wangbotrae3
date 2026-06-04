use serde::{Serialize, Deserialize};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum SparseError {
    #[error("Invalid matrix dimensions")]
    InvalidDimensions,
    #[error("Index out of bounds")]
    IndexOutOfBounds,
    #[error("Invalid format conversion")]
    InvalidConversion,
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CooMatrix {
    pub rows: usize,
    pub cols: usize,
    pub row_indices: Vec<usize>,
    pub col_indices: Vec<usize>,
    pub values: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CsrMatrix {
    pub rows: usize,
    pub cols: usize,
    pub indptr: Vec<usize>,
    pub indices: Vec<usize>,
    pub data: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CscMatrix {
    pub rows: usize,
    pub cols: usize,
    pub indptr: Vec<usize>,
    pub indices: Vec<usize>,
    pub data: Vec<f64>,
}

pub enum SparseMatrix {
    Coo(CooMatrix),
    Csr(CsrMatrix),
    Csc(CscMatrix),
}

impl CooMatrix {
    pub fn new(rows: usize, cols: usize) -> Self {
        CooMatrix {
            rows,
            cols,
            row_indices: Vec::new(),
            col_indices: Vec::new(),
            values: Vec::new(),
        }
    }

    pub fn push(&mut self, row: usize, col: usize, value: f64) -> Result<(), SparseError> {
        if row >= self.rows || col >= self.cols {
            return Err(SparseError::IndexOutOfBounds);
        }
        self.row_indices.push(row);
        self.col_indices.push(col);
        self.values.push(value);
        Ok(())
    }

    pub fn nnz(&self) -> usize {
        self.values.len()
    }

    pub fn to_csr(&self) -> Result<CsrMatrix, SparseError> {
        let mut counts = vec![0usize; self.rows];
        for &r in &self.row_indices {
            counts[r] += 1;
        }

        let mut indptr = vec![0usize; self.rows + 1];
        for i in 0..self.rows {
            indptr[i + 1] = indptr[i] + counts[i];
        }

        let mut current = indptr.clone();
        let mut indices = vec![0usize; self.nnz()];
        let mut data = vec![0f64; self.nnz()];

        for k in 0..self.nnz() {
            let r = self.row_indices[k];
            let c = self.col_indices[k];
            let v = self.values[k];
            let pos = current[r];
            indices[pos] = c;
            data[pos] = v;
            current[r] += 1;
        }

        for r in 0..self.rows {
            let start = indptr[r];
            let end = indptr[r + 1];
            let mut order: Vec<usize> = (start..end).collect();
            order.sort_by_key(|&i| indices[i]);
            
            let sorted_indices: Vec<usize> = order.iter().map(|&i| indices[i]).collect();
            let sorted_data: Vec<f64> = order.iter().map(|&i| data[i]).collect();
            
            indices[start..end].copy_from_slice(&sorted_indices);
            data[start..end].copy_from_slice(&sorted_data);
        }

        Ok(CsrMatrix {
            rows: self.rows,
            cols: self.cols,
            indptr,
            indices,
            data,
        })
    }

    pub fn to_csc(&self) -> Result<CscMatrix, SparseError> {
        let mut counts = vec![0usize; self.cols];
        for &c in &self.col_indices {
            counts[c] += 1;
        }

        let mut indptr = vec![0usize; self.cols + 1];
        for i in 0..self.cols {
            indptr[i + 1] = indptr[i] + counts[i];
        }

        let mut current = indptr.clone();
        let mut indices = vec![0usize; self.nnz()];
        let mut data = vec![0f64; self.nnz()];

        for k in 0..self.nnz() {
            let r = self.row_indices[k];
            let c = self.col_indices[k];
            let v = self.values[k];
            let pos = current[c];
            indices[pos] = r;
            data[pos] = v;
            current[c] += 1;
        }

        for c in 0..self.cols {
            let start = indptr[c];
            let end = indptr[c + 1];
            let mut order: Vec<usize> = (start..end).collect();
            order.sort_by_key(|&i| indices[i]);
            
            let sorted_indices: Vec<usize> = order.iter().map(|&i| indices[i]).collect();
            let sorted_data: Vec<f64> = order.iter().map(|&i| data[i]).collect();
            
            indices[start..end].copy_from_slice(&sorted_indices);
            data[start..end].copy_from_slice(&sorted_data);
        }

        Ok(CscMatrix {
            rows: self.rows,
            cols: self.cols,
            indptr,
            indices,
            data,
        })
    }
}

impl CsrMatrix {
    pub fn nnz(&self) -> usize {
        self.data.len()
    }

    pub fn to_coo(&self) -> Result<CooMatrix, SparseError> {
        let mut row_indices = Vec::with_capacity(self.nnz());
        let mut col_indices = Vec::with_capacity(self.nnz());
        let mut values = Vec::with_capacity(self.nnz());

        for r in 0..self.rows {
            let start = self.indptr[r];
            let end = self.indptr[r + 1];
            for k in start..end {
                row_indices.push(r);
                col_indices.push(self.indices[k]);
                values.push(self.data[k]);
            }
        }

        Ok(CooMatrix {
            rows: self.rows,
            cols: self.cols,
            row_indices,
            col_indices,
            values,
        })
    }

    pub fn to_csc(&self) -> Result<CscMatrix, SparseError> {
        self.to_coo()?.to_csc()
    }
}

impl CscMatrix {
    pub fn nnz(&self) -> usize {
        self.data.len()
    }

    pub fn to_coo(&self) -> Result<CooMatrix, SparseError> {
        let mut row_indices = Vec::with_capacity(self.nnz());
        let mut col_indices = Vec::with_capacity(self.nnz());
        let mut values = Vec::with_capacity(self.nnz());

        for c in 0..self.cols {
            let start = self.indptr[c];
            let end = self.indptr[c + 1];
            for k in start..end {
                row_indices.push(self.indices[k]);
                col_indices.push(c);
                values.push(self.data[k]);
            }
        }

        Ok(CooMatrix {
            rows: self.rows,
            cols: self.cols,
            row_indices,
            col_indices,
            values,
        })
    }

    pub fn to_csr(&self) -> Result<CsrMatrix, SparseError> {
        self.to_coo()?.to_csr()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_coo_to_csr() {
        let mut coo = CooMatrix::new(3, 3);
        coo.push(0, 0, 1.0).unwrap();
        coo.push(0, 2, 2.0).unwrap();
        coo.push(1, 1, 3.0).unwrap();
        coo.push(2, 0, 4.0).unwrap();
        coo.push(2, 2, 5.0).unwrap();

        let csr = coo.to_csr().unwrap();
        assert_eq!(csr.indptr, vec![0, 2, 3, 5]);
        assert_eq!(csr.indices, vec![0, 2, 1, 0, 2]);
    }

    #[test]
    fn test_coo_to_csc() {
        let mut coo = CooMatrix::new(3, 3);
        coo.push(0, 0, 1.0).unwrap();
        coo.push(0, 2, 2.0).unwrap();
        coo.push(1, 1, 3.0).unwrap();
        coo.push(2, 0, 4.0).unwrap();
        coo.push(2, 2, 5.0).unwrap();

        let csc = coo.to_csc().unwrap();
        assert_eq!(csc.indptr, vec![0, 2, 3, 5]);
        assert_eq!(csc.indices, vec![0, 2, 1, 0, 2]);
    }
}
