use crate::formats::{CooMatrix, SparseError};
use crate::autodiff::SparsityPattern;
use crate::structure::MatrixStructure;
use serde::{Serialize, Deserialize};
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
pub struct MatrixJsonOutput {
    pub format: String,
    pub rows: usize,
    pub cols: usize,
    pub nnz: usize,
    pub structure: Option<MatrixStructure>,
    pub sparsity_pattern: Vec<(usize, usize)>,
    pub values: Option<Vec<f64>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SparsityJsonOutput {
    pub name: Option<String>,
    pub rows: usize,
    pub cols: usize,
    pub nnz: usize,
    pub density: f64,
    pub description: Option<String>,
    pub positions: Vec<(usize, usize)>,
}

pub fn save_json(matrix: &CooMatrix, path: &Path) -> Result<(), SparseError> {
    let output = MatrixJsonOutput {
        format: "COO".to_string(),
        rows: matrix.rows,
        cols: matrix.cols,
        nnz: matrix.nnz(),
        structure: None,
        sparsity_pattern: matrix
            .row_indices
            .iter()
            .zip(matrix.col_indices.iter())
            .map(|(&r, &c)| (r, c))
            .collect(),
        values: Some(matrix.values.clone()),
    };

    let json = serde_json::to_string_pretty(&output)?;
    let mut file = File::create(path)?;
    file.write_all(json.as_bytes())?;
    Ok(())
}

pub fn save_sparsity_json(pattern: &SparsityPattern, path: &Path, name: Option<&str>) -> Result<(), SparseError> {
    let output = SparsityJsonOutput {
        name: name.map(|s| s.to_string()),
        rows: pattern.rows,
        cols: pattern.cols,
        nnz: pattern.nnz(),
        density: pattern.density(),
        description: pattern.description.clone(),
        positions: pattern.positions.iter().cloned().collect(),
    };

    let json = serde_json::to_string_pretty(&output)?;
    let mut file = File::create(path)?;
    file.write_all(json.as_bytes())?;
    Ok(())
}

pub fn save_dot(matrix: &CooMatrix, path: &Path, title: Option<&str>) -> Result<(), SparseError> {
    let mut file = File::create(path)?;
    writeln!(file, "digraph SparseMatrix {{")?;
    writeln!(file, "    rankdir=LR;")?;
    writeln!(file, "    node [shape=circle, style=filled, fontsize=10];")?;
    
    if let Some(t) = title {
        writeln!(file, "    label=\"{}\";", t)?;
    }

    for r in 0..matrix.rows {
        writeln!(file, "    r{} [label=\"r{}\", fillcolor=\"#a6cee3\"];", r, r)?;
    }
    for c in 0..matrix.cols {
        writeln!(file, "    c{} [label=\"c{}\", fillcolor=\"#b2df8a\"];", c, c)?;
    }

    for i in 0..matrix.nnz() {
        let r = matrix.row_indices[i];
        let c = matrix.col_indices[i];
        let v = matrix.values[i];
        writeln!(
            file,
            "    r{} -> c{} [label=\"{:.2}\", penwidth={:.1}];",
            r,
            c,
            v,
            1.0 + v.abs().min(3.0)
        )?;
    }

    writeln!(file, "}}")?;
    Ok(())
}

pub fn save_sparsity_dot(pattern: &SparsityPattern, path: &Path, title: Option<&str>) -> Result<(), SparseError> {
    let mut file = File::create(path)?;
    writeln!(file, "graph SparsityPattern {{")?;
    writeln!(file, "    layout=neato;")?;
    writeln!(file, "    node [shape=square, style=filled, fontsize=8, width=0.3, height=0.3];")?;
    writeln!(file, "    edge [style=invis];")?;
    
    if let Some(t) = title {
        writeln!(file, "    label=\"{}\";", t)?;
    }

    for r in 0..pattern.rows {
        for c in 0..pattern.cols {
            let pos = (r, c);
            let filled = pattern.positions.contains(&pos);
            let color = if filled { "#1f78b4" } else { "#f0f0f0" };
            writeln!(
                file,
                "    n_{}_{} [label=\"\", pos=\"{},{}!\", fillcolor=\"{}\"];",
                r,
                c,
                c as f64 * 0.5,
                -(r as f64) * 0.5,
                color
            )?;
        }
    }

    writeln!(file, "}}")?;
    Ok(())
}

pub fn save_bipartite_dot(pattern: &SparsityPattern, path: &Path, title: Option<&str>) -> Result<(), SparseError> {
    let mut file = File::create(path)?;
    writeln!(file, "graph BipartiteGraph {{")?;
    writeln!(file, "    rankdir=LR;")?;
    writeln!(file, "    node [shape=circle, style=filled];")?;
    
    if let Some(t) = title {
        writeln!(file, "    label=\"{}\";", t)?;
    }

    writeln!(file, "    {{ rank=same;");
    for r in 0..pattern.rows {
        writeln!(file, "        row{} [label=\"r{}\", fillcolor=\"#a6cee3\"];", r, r)?;
    }
    writeln!(file, "    }}");

    writeln!(file, "    {{ rank=same;");
    for c in 0..pattern.cols {
        writeln!(file, "        col{} [label=\"c{}\", fillcolor=\"#b2df8a\"];", c, c)?;
    }
    writeln!(file, "    }}");

    for &(r, c) in &pattern.positions {
        writeln!(file, "    row{} -- col{};", r, c)?;
    }

    writeln!(file, "}}")?;
    Ok(())
}

pub fn load_matrix_market(path: &Path) -> Result<CooMatrix, SparseError> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();

    let header = lines.next().ok_or(SparseError::InvalidConversion)??;
    if !header.starts_with("%%MatrixMarket") {
        return Err(SparseError::InvalidConversion);
    }

    let mut comment_lines = Vec::new();
    loop {
        match lines.next() {
            Some(Ok(line)) if line.starts_with('%') => {
                comment_lines.push(line);
            }
            Some(Ok(line)) => {
                let parts: Vec<usize> = line
                    .split_whitespace()
                    .map(|s| s.parse().unwrap_or(0))
                    .collect();
                if parts.len() >= 2 {
                    let rows = parts[0];
                    let cols = parts[1];
                    let nnz = if parts.len() >= 3 { parts[2] } else { 0 };
                    
                    let mut coo = CooMatrix::new(rows, cols);
                    
                    for _ in 0..nnz {
                        if let Some(Ok(line)) = lines.next() {
                            let parts: Vec<&str> = line.split_whitespace().collect();
                            if parts.len() >= 2 {
                                let r: usize = parts[0].parse().unwrap_or(0);
                                let c: usize = parts[1].parse().unwrap_or(0);
                                let v: f64 = if parts.len() >= 3 {
                                    parts[2].parse().unwrap_or(1.0)
                                } else {
                                    1.0
                                };
                                coo.push(r - 1, c - 1, v)?;
                            }
                        }
                    }
                    return Ok(coo);
                }
            }
            _ => break,
        }
    }

    Err(SparseError::InvalidConversion)
}

impl From<serde_json::Error> for SparseError {
    fn from(_: serde_json::Error) -> Self {
        SparseError::InvalidConversion
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_save_json() {
        let mut coo = CooMatrix::new(3, 3);
        coo.push(0, 0, 1.0).unwrap();
        coo.push(1, 1, 2.0).unwrap();
        coo.push(2, 2, 3.0).unwrap();

        let path = std::env::temp_dir().join("sparse_test_json.json");
        let _ = std::fs::remove_file(&path);
        save_json(&coo, &path).unwrap();
        assert!(path.exists());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_save_dot() {
        let mut coo = CooMatrix::new(3, 3);
        coo.push(0, 1, 2.0).unwrap();
        coo.push(1, 1, 3.0).unwrap();

        let path = std::env::temp_dir().join("sparse_test_dot.dot");
        let _ = std::fs::remove_file(&path);
        save_dot(&coo, &path, Some("Test Matrix")).unwrap();
        assert!(path.exists());
        let _ = std::fs::remove_file(&path);
    }
}
