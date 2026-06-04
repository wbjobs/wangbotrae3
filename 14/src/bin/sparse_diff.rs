use clap::Parser;
use sparse_matrix_tool::*;
use std::path::PathBuf;
use std::collections::{HashMap, HashSet};

#[derive(Parser, Debug)]
#[command(name = "sparse-diff")]
#[command(about = "Analyze sparsity patterns for automatic differentiation")]
struct Cli {
    #[arg(short, long)]
    func: Option<String>,

    #[arg(long)]
    input_matrix: Option<PathBuf>,

    #[arg(long)]
    sparsity_pattern: bool,

    #[arg(long)]
    jacobian: bool,

    #[arg(long)]
    hessian: bool,

    #[arg(long)]
    input_size: Option<usize>,

    #[arg(long)]
    output_size: Option<usize>,

    #[arg(long)]
    check_risk: bool,

    #[arg(long)]
    output_json: Option<PathBuf>,

    #[arg(long)]
    output_dot: Option<PathBuf>,

    #[arg(long)]
    output_bipartite: Option<PathBuf>,
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
    let pattern = if let Some(matrix_path) = &cli.input_matrix {
        println!("Loading matrix from: {:?}", matrix_path);
        let coo = io::load_matrix_market(matrix_path)?;
        
        println!("Matrix: {} x {} with {} non-zeros", coo.rows, coo.cols, coo.nnz());
        
        let mut symbolic = symbolic::SymbolicMatrix::from_coo(&coo, Some("A"));

        if cli.check_risk {
            let report = autodiff::check_explosion_risk(&symbolic);
            println!("\n=== Explosion Risk Report ===");
            println!("Total nnz estimate: {}", report.total_nnz_estimate);
            println!("Max element nnz: {}", report.max_element_nnz);
            println!("Is safe: {}", report.is_safe);
            let risk = match report.risk_level {
                autodiff::RiskLevel::Low => "Low",
                autodiff::RiskLevel::Medium => "Medium",
                autodiff::RiskLevel::High => "High",
                autodiff::RiskLevel::Critical => "Critical",
            };
            println!("Risk level: {}", risk);
        }
        
        if cli.jacobian {
            let input_size = cli.input_size.unwrap_or(coo.cols);
            autodiff::symbolic_jacobian_sparsity(&symbolic, input_size)?
        } else if cli.hessian {
            let input_size = cli.input_size.unwrap_or(coo.rows);
            autodiff::symbolic_hessian_sparsity(&mut symbolic, input_size)?
        } else {
            autodiff::SparsityPattern::from_symbolic_matrix(&symbolic)
        }
    } else if let Some(func_str) = &cli.func {
        println!("Parsing function: {}", func_str);
        
        let input_size = cli.input_size.unwrap_or(3);
        let output_size = cli.output_size.unwrap_or(3);
        
        let (deps, actual_input_size, actual_output_size) = 
            parse_function_dependencies(func_str, input_size, output_size)?;
        
        if cli.hessian {
            let mut hessian_deps = HashMap::new();
            for (_out_idx, inputs) in &deps {
                for &in1 in inputs {
                    for &in2 in inputs {
                        hessian_deps.insert((in1, in2), HashSet::new());
                    }
                }
            }
            autodiff::hessian_sparsity(actual_input_size, &hessian_deps)
        } else {
            autodiff::jacobian_sparsity(actual_input_size, actual_output_size, &deps)
        }
    } else {
        return Err("Either --func or --input-matrix must be provided".into());
    };

    println!("\n=== Sparsity Pattern Analysis ===");
    println!("Dimensions: {} x {}", pattern.rows, pattern.cols);
    println!("Non-zeros: {}", pattern.nnz());
    println!("Density: {:.4}%", 100.0 * pattern.density());
    if pattern.is_approximate {
        println!("** APPROXIMATE MODE ** - result may over-estimate non-zeros");
    }
    if let Some(desc) = &pattern.description {
        println!("Description: {}", desc);
    }

    if cli.sparsity_pattern || cli.jacobian || cli.hessian {
        println!("\nNon-zero positions:");
        let mut positions: Vec<_> = pattern.positions.iter().collect();
        positions.sort();
        for &(r, c) in positions.iter().take(20) {
            println!("  ({}, {})", r, c);
        }
        if positions.len() > 20 {
            println!("  ... and {} more", positions.len() - 20);
        }
    }

    if let Some(json_path) = &cli.output_json {
        println!("\nSaving sparsity JSON to: {:?}", json_path);
        io::save_sparsity_json(&pattern, json_path, cli.func.as_deref())?;
        println!("JSON saved successfully");
    }

    if let Some(dot_path) = &cli.output_dot {
        println!("\nSaving sparsity dot file to: {:?}", dot_path);
        let title = if cli.jacobian {
            "Jacobian Sparsity Pattern"
        } else if cli.hessian {
            "Hessian Sparsity Pattern"
        } else {
            "Sparsity Pattern"
        };
        io::save_sparsity_dot(&pattern, dot_path, Some(title))?;
        println!("Dot file saved successfully");
    }

    if let Some(bip_path) = &cli.output_bipartite {
        println!("\nSaving bipartite graph to: {:?}", bip_path);
        io::save_bipartite_dot(&pattern, bip_path, Some("Bipartite Graph"))?;
        println!("Bipartite dot file saved successfully");
    }

    Ok(())
}

fn parse_function_dependencies(
    func_str: &str,
    input_size: usize,
    output_size: usize,
) -> Result<(HashMap<usize, HashSet<usize>>, usize, usize), Box<dyn std::error::Error>> {
    let mut deps = HashMap::new();

    if func_str.contains("A*x") || func_str.contains("A * x") {
        for i in 0..output_size {
            let mut inputs = HashSet::new();
            for j in 0..input_size {
                inputs.insert(j);
            }
            deps.insert(i, inputs);
        }
    } else if func_str.contains("tridiagonal") || func_str.contains("tri-diagonal") {
        for i in 0..output_size {
            let mut inputs = HashSet::new();
            if i > 0 {
                inputs.insert(i - 1);
            }
            inputs.insert(i);
            if i < input_size - 1 {
                inputs.insert(i + 1);
            }
            deps.insert(i, inputs);
        }
    } else if func_str.contains("diagonal") {
        for i in 0..output_size.min(input_size) {
            let mut inputs = HashSet::new();
            inputs.insert(i);
            deps.insert(i, inputs);
        }
    } else if func_str.contains("band") {
        let bandwidth = 1;
        for i in 0..output_size {
            let mut inputs = HashSet::new();
            for j in 0..input_size {
                if (i as isize - j as isize).abs() <= bandwidth as isize {
                    inputs.insert(j);
                }
            }
            deps.insert(i, inputs);
        }
    } else {
        for i in 0..output_size {
            let mut inputs = HashSet::new();
            inputs.insert(i % input_size);
            if i + 1 < input_size {
                inputs.insert((i + 1) % input_size);
            }
            deps.insert(i, inputs);
        }
    }

    Ok((deps, input_size, output_size))
}
