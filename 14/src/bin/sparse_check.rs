use clap::Parser;
use sparse_matrix_tool::*;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "sparse-check")]
#[command(about = "Analyze sparse matrix structure and properties")]
struct Cli {
    #[arg(short, long)]
    input: PathBuf,

    #[arg(long)]
    detect_structure: bool,

    #[arg(long)]
    convert_to: Option<String>,

    #[arg(long)]
    output_json: Option<PathBuf>,

    #[arg(long)]
    output_dot: Option<PathBuf>,

    #[arg(long, default_value_t = false)]
    verbose: bool,
}

fn main() {
    let cli = Cli::parse();

    match run(&cli) {
        Ok(_) => {}
        Err(e) => {
            eprintln!("Error: {}", e);
            std::process::exit(1);
        }
    }
}

fn run(cli: &Cli) -> Result<(), Box<dyn std::error::Error>> {
    println!("Loading matrix from: {:?}", cli.input);
    
    let coo = io::load_matrix_market(&cli.input)?;
    
    println!("Matrix dimensions: {} x {}", coo.rows, coo.cols);
    println!("Non-zero elements: {}", coo.nnz());
    println!(
        "Sparsity ratio: {:.4}%",
        100.0 * (1.0 - coo.nnz() as f64 / (coo.rows * coo.cols) as f64)
    );

    if cli.detect_structure {
        println!("\n=== Matrix Structure Analysis ===");
        let structure = structure::detect_structure(&coo);
        
        if cli.verbose {
            println!("Structure details:");
            println!("  Symmetric: {}", structure.is_symmetric);
            println!("  Skew-symmetric: {}", structure.is_skew_symmetric);
            println!("  Upper triangular: {}", structure.is_upper_triangular);
            println!("  Lower triangular: {}", structure.is_lower_triangular);
            println!("  Diagonal: {}", structure.is_diagonal);
            println!("  Banded: {}", structure.is_banded);
            if let Some(bw) = structure.band_width {
                println!("  Band width: {}", bw);
            }
            println!("  Identity: {}", structure.is_identity);
            println!("  Permutation: {}", structure.is_permutation);
            if let Some(pd) = structure.is_positive_definite {
                println!("  Positive definite: {}", pd);
            }
        } else {
            let mut structures = Vec::new();
            if structure.is_diagonal {
                structures.push("diagonal");
            }
            if structure.is_identity {
                structures.push("identity");
            }
            if structure.is_permutation {
                structures.push("permutation");
            }
            if structure.is_symmetric {
                structures.push("symmetric");
            }
            if structure.is_skew_symmetric {
                structures.push("skew-symmetric");
            }
            if structure.is_upper_triangular {
                structures.push("upper-triangular");
            }
            if structure.is_lower_triangular {
                structures.push("lower-triangular");
            }
            if structure.is_banded {
                structures.push("banded");
            }
            println!("Detected structures: {}", structures.join(", "));
        }
    }

    if let Some(format) = &cli.convert_to {
        println!("\nConverting to format: {}", format);
        match format.to_lowercase().as_str() {
            "csr" => {
                let csr = coo.to_csr()?;
                println!("CSR conversion successful:");
                println!("  indptr length: {}", csr.indptr.len());
                println!("  indices length: {}", csr.indices.len());
            }
            "csc" => {
                let csc = coo.to_csc()?;
                println!("CSC conversion successful:");
                println!("  indptr length: {}", csc.indptr.len());
                println!("  indices length: {}", csc.indices.len());
            }
            _ => {
                eprintln!("Unsupported format: {}", format);
            }
        }
    }

    if let Some(json_path) = &cli.output_json {
        println!("\nSaving JSON to: {:?}", json_path);
        io::save_json(&coo, json_path)?;
        println!("JSON saved successfully");
    }

    if let Some(dot_path) = &cli.output_dot {
        println!("\nSaving GraphViz dot file to: {:?}", dot_path);
        io::save_dot(&coo, dot_path, Some("Sparse Matrix Visualization"))?;
        println!("Dot file saved successfully");
    }

    Ok(())
}
