use clap::Parser;
use sparse_matrix_tool::*;
use std::path::PathBuf;
use sparse_matrix_tool::structure_propagation::StructureConstraint;

#[derive(Parser, Debug)]
#[command(name = "structure-propagate")]
#[command(about = "Analyze matrix structure propagation through operations")]
struct Cli {
    #[arg(long, num_args = 1..)]
    matrix: Vec<PathBuf>,

    #[arg(long)]
    operation: Option<String>,

    #[arg(long)]
    show_tree: bool,

    #[arg(long)]
    suggest: bool,

    #[arg(long, num_args = 1..)]
    constraint: Vec<String>,

    #[arg(long)]
    output_json: Option<PathBuf>,

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
    if cli.matrix.is_empty() {
        return Err("No matrices provided. Use --matrix to specify input matrices.".into());
    }

    println!("Loading {} matrix(es)...", cli.matrix.len());
    let mut matrices = Vec::new();
    for (i, path) in cli.matrix.iter().enumerate() {
        let coo = io::load_matrix_market(path)?;
        let structure = structure::detect_structure(&coo);
        let name = format!("M{}", i);
        println!("  {}: {}x{} - {}", name, coo.rows, coo.cols, structure_propagation::format_structure(&structure));
        
        matrices.push((name, coo.rows, coo.cols, structure));
    }

    let expr = if let Some(op) = &cli.operation {
        parse_operation(op, &matrices)?
    } else {
        if matrices.len() >= 2 {
            let m0 = MatrixExpr::Matrix {
                name: matrices[0].0.clone(),
                rows: matrices[0].1,
                cols: matrices[0].2,
                structure: matrices[0].3.clone(),
            };
            let m1 = MatrixExpr::Matrix {
                name: matrices[1].0.clone(),
                rows: matrices[1].1,
                cols: matrices[1].2,
                structure: matrices[1].3.clone(),
            };
            MatrixExpr::Multiply(Box::new(m0), Box::new(m1))
        } else {
            MatrixExpr::Matrix {
                name: matrices[0].0.clone(),
                rows: matrices[0].1,
                cols: matrices[0].2,
                structure: matrices[0].3.clone(),
            }
        }
    };

    println!("\n=== Structure Propagation Result ===");
    let (final_struct, rows, cols) = structure_propagation::propagate_structure(&expr)?;
    println!("Output dimensions: {} x {}", rows, cols);
    println!("Output structure: {}", structure_propagation::format_structure(&final_struct));

    if cli.show_tree {
        println!("\n=== Structure Derivation Tree ===");
        let tree = structure_propagation::build_derivation_tree(&expr)?;
        structure_propagation::print_derivation_tree(&tree);
    }

    if !cli.constraint.is_empty() {
        println!("\n=== Constraint Verification ===");
        let constraints: Vec<StructureConstraint> = cli.constraint.iter()
            .map(|c| parse_constraint(c))
            .collect::<Result<_, _>>()?;
        
        let violations = structure_propagation::verify_constraints(&expr, &constraints)?;
        
        if violations.is_empty() {
            println!("All constraints satisfied!");
        } else {
            println!("{} constraint violation(s) detected:", violations.len());
            for v in violations {
                println!("  Constraint '{}' violated", structure_propagation::format_constraint(&v.constraint));
                println!("    Actual: {}", v.actual_structure);
                if let Some(s) = v.suggestion {
                    println!("    Source: {}", s);
                }
            }
        }
    }

    let mut all_suggestions = None;
    if cli.suggest {
        println!("\n=== Optimization Suggestions ===");
        let suggestions = structure_propagation::generate_suggestions(&expr)?;
        all_suggestions = Some(suggestions.clone());
        
        if suggestions.is_empty() {
            println!("No optimization suggestions found.");
        } else {
            for (i, s) in suggestions.iter().enumerate() {
                println!("{}. [{}] {}", i + 1, s.suggestion_type, s.description);
                println!("   Location: {}", s.location);
                println!("   Benefit: {}", s.potential_benefit);
            }
        }
    }

    if let Some(json_path) = &cli.output_json {
        println!("\nSaving structure analysis to: {:?}", json_path);
        let output = StructureAnalysisOutput {
            operation: cli.operation.clone(),
            output_dimensions: (rows, cols),
            structure: final_struct,
            suggestions: all_suggestions,
        };
        let json = serde_json::to_string_pretty(&output)?;
        std::fs::write(json_path, json)?;
        println!("JSON saved successfully");
    }

    Ok(())
}

fn parse_operation(op: &str, matrices: &[(String, usize, usize, MatrixStructure)]) 
    -> Result<MatrixExpr, Box<dyn std::error::Error>> {
    let chars: Vec<char> = op.chars().collect();
    let mut pos = 0;
    
    fn parse_expr(chars: &[char], pos: &mut usize, matrices: &[(String, usize, usize, MatrixStructure)]) 
        -> Result<MatrixExpr, Box<dyn std::error::Error>> {
        
        skip_whitespace(chars, pos);
        
        if *pos >= chars.len() {
            return Err("Unexpected end of expression".into());
        }
        
        if chars[*pos] == '(' {
            *pos += 1;
            let expr = parse_expr(chars, pos, matrices)?;
            skip_whitespace(chars, pos);
            if *pos < chars.len() && chars[*pos] == ')' {
                *pos += 1;
            }
            return Ok(expr);
        }
        
        if chars[*pos].is_ascii_digit() {
            let start = *pos;
            while *pos < chars.len() && chars[*pos].is_ascii_digit() {
                *pos += 1;
            }
            let idx_str: String = chars[start..*pos].iter().collect();
            let idx: usize = idx_str.parse()?;
            if idx >= matrices.len() {
                return Err(format!("Matrix index {} out of range (only {} matrices)", idx, matrices.len()).into());
            }
            return Ok(MatrixExpr::Matrix {
                name: matrices[idx].0.clone(),
                rows: matrices[idx].1,
                cols: matrices[idx].2,
                structure: matrices[idx].3.clone(),
            });
        }
        
        let start = *pos;
        while *pos < chars.len() && chars[*pos].is_ascii_alphabetic() {
            *pos += 1;
        }
        let word: String = chars[start..*pos].iter().collect();
        
        match word.to_uppercase().as_str() {
            "TRANSPOSE" | "T" => {
                skip_whitespace(chars, pos);
                if *pos < chars.len() && chars[*pos] == '(' {
                    *pos += 1;
                    let inner = parse_expr(chars, pos, matrices)?;
                    skip_whitespace(chars, pos);
                    if *pos < chars.len() && chars[*pos] == ')' {
                        *pos += 1;
                    }
                    return Ok(MatrixExpr::Transpose(Box::new(inner)));
                }
                return Err("transpose requires argument".into());
            }
            _ => {
                if word.len() == 1 {
                    let c = word.chars().next().unwrap();
                    let idx = (c as usize - 'A' as usize).min(matrices.len() - 1);
                    return Ok(MatrixExpr::Matrix {
                        name: matrices[idx].0.clone(),
                        rows: matrices[idx].1,
                        cols: matrices[idx].2,
                        structure: matrices[idx].3.clone(),
                    });
                }
                return Err(format!("Unknown identifier: {}", word).into());
            }
        }
    }
    
    fn skip_whitespace(chars: &[char], pos: &mut usize) {
        while *pos < chars.len() && chars[*pos].is_whitespace() {
            *pos += 1;
        }
    }
    
    let mut expr = parse_expr(&chars, &mut pos, matrices)?;
    
    skip_whitespace(&chars, &mut pos);
    while pos < chars.len() {
        match chars[pos] {
            '+' => {
                pos += 1;
                let right = parse_expr(&chars, &mut pos, matrices)?;
                expr = MatrixExpr::Add(Box::new(expr), Box::new(right));
            }
            '*' => {
                pos += 1;
                let right = parse_expr(&chars, &mut pos, matrices)?;
                expr = MatrixExpr::Multiply(Box::new(expr), Box::new(right));
            }
            _ => break,
        }
        skip_whitespace(&chars, &mut pos);
    }
    
    Ok(expr)
}

fn parse_constraint(c: &str) -> Result<StructureConstraint, Box<dyn std::error::Error>> {
    let c_lower = c.to_lowercase();
    if c_lower == "symmetric" {
        Ok(StructureConstraint::Symmetric)
    } else if c_lower == "upper-triangular" || c_lower == "upper" {
        Ok(StructureConstraint::UpperTriangular)
    } else if c_lower == "lower-triangular" || c_lower == "lower" {
        Ok(StructureConstraint::LowerTriangular)
    } else if c_lower == "diagonal" {
        Ok(StructureConstraint::Diagonal)
    } else if c_lower.starts_with("banded") {
        let bw: usize = c_lower
            .split('=')
            .nth(1)
            .unwrap_or("5")
            .parse()?;
        Ok(StructureConstraint::Banded { max_bandwidth: bw })
    } else if c_lower.starts_with("sparse") {
        let density: f64 = c_lower
            .split('=')
            .nth(1)
            .unwrap_or("0.1")
            .parse()?;
        Ok(StructureConstraint::Sparse { max_density: density })
    } else {
        Err(format!("Unknown constraint: {}", c).into())
    }
}

#[derive(Debug, serde::Serialize)]
struct StructureAnalysisOutput {
    operation: Option<String>,
    output_dimensions: (usize, usize),
    structure: MatrixStructure,
    suggestions: Option<Vec<OptimizationSuggestion>>,
}
