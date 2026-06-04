use clap::{Parser, Subcommand};
use anyhow::Result;
use std::path::PathBuf;

use crate::coverage::CoverageBackend;
use crate::crash::{CrashAnalyzer, CrashMinimizer, CrashInfo};
use crate::fuzzer::{FuzzConfig, Fuzzer};
use crate::seed::{PcapExtractor, SeedManager};
use crate::statemachine::{SessionAnalyzer, ProtocolStateMachine};

#[derive(Parser)]
#[command(name = "fuzz")]
#[command(about = "Coverage-guided binary protocol fuzzer and state machine analyzer", long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,

    #[arg(short, long, global = true)]
    pub verbose: bool,

    #[arg(short, long, global = true)]
    pub quiet: bool,
}

#[derive(Subcommand)]
pub enum Commands {
    Run {
        #[arg(short, long)]
        target: String,

        #[arg(short, long, default_value = "seeds/")]
        input: PathBuf,

        #[arg(short, long, default_value = "output/")]
        output: PathBuf,

        #[arg(short, long, default_value_t = 1)]
        workers: usize,

        #[arg(long, default_value_t = 30)]
        timeout: u64,

        #[arg(long, default_value_t = 1000)]
        max_crashes: usize,

        #[arg(long, value_enum, default_value = "qemu")]
        coverage: CoverageArg,

        #[arg(long)]
        no_statemachine: bool,
    },

    Minimize {
        #[arg(short, long)]
        crash: PathBuf,

        #[arg(short, long)]
        target: String,

        #[arg(short, long)]
        output: PathBuf,

        #[arg(long, default_value_t = 30)]
        timeout: u64,

        #[arg(long, default_value_t = 1000)]
        iterations: usize,
    },

    Statemachine {
        #[arg(short, long)]
        session: PathBuf,

        #[arg(short, long)]
        output: PathBuf,

        #[arg(long)]
        json: bool,

        #[arg(long)]
        min_count: Option<u64>,
    },

    Extract {
        #[arg(short, long)]
        pcap: PathBuf,

        #[arg(short, long)]
        output: PathBuf,

        #[arg(long)]
        protocol: Option<String>,

        #[arg(long, default_value_t = 1)]
        min_length: usize,

        #[arg(long, default_value_t = 65535)]
        max_length: usize,
    },

    Analyze {
        #[arg(short, long)]
        crashes: PathBuf,

        #[arg(short, long)]
        output: PathBuf,

        #[arg(long)]
        summary_only: bool,
    },

    Corpus {
        #[arg(short, long)]
        input: PathBuf,

        #[arg(long)]
        list: bool,

        #[arg(long)]
        stats: bool,
    },
}

#[derive(clap::ValueEnum, Clone, Copy)]
pub enum CoverageArg {
    Qemu,
    IntelPt,
    SanCov,
}

impl From<CoverageArg> for CoverageBackend {
    fn from(arg: CoverageArg) -> Self {
        match arg {
            CoverageArg::Qemu => CoverageBackend::Qemu,
            CoverageArg::IntelPt => CoverageBackend::IntelPT,
            CoverageArg::SanCov => CoverageBackend::SanitizerCoverage,
        }
    }
}

pub fn run_cli() -> Result<()> {
    let cli = Cli::parse();

    if cli.verbose {
        std::env::set_var("RUST_LOG", "debug");
    } else if cli.quiet {
        std::env::set_var("RUST_LOG", "error");
    } else {
        std::env::set_var("RUST_LOG", "info");
    }
    env_logger::init();

    match cli.command {
        Commands::Run {
            target,
            input,
            output,
            workers,
            timeout,
            max_crashes,
            coverage,
            no_statemachine,
        } => {
            let config = FuzzConfig {
                target: target.clone(),
                input_dir: input.to_string_lossy().to_string(),
                output_dir: output.to_string_lossy().to_string(),
                workers,
                timeout,
                max_crashes,
                coverage_backend: coverage.into(),
                enable_statemachine: !no_statemachine,
            };

            println!("========================================");
            println!("ProtoFuzz - Protocol Fuzzer");
            println!("========================================");
            println!("Target: {}", target);
            println!("Input dir: {}", input.display());
            println!("Output dir: {}", output.display());
            println!("Workers: {}", workers);
            println!("========================================");
            println!();

            let mut fuzzer = Fuzzer::new(config)?;
            
            ctrlc::set_handler(move || {
                eprintln!("\nReceived Ctrl+C, stopping...");
                std::process::exit(0);
            })?;

            fuzzer.run()?;
        }

        Commands::Minimize {
            crash,
            target,
            output,
            timeout,
            iterations,
        } => {
            println!("Crash Minimizer");
            println!("===============");
            println!("Crash file: {}", crash.display());
            println!("Target: {}", target);
            println!("Output: {}", output.display());
            println!();

            let input = std::fs::read(&crash)?;
            println!("Original size: {} bytes", input.len());

            let minimizer = CrashMinimizer::new(target)
                .with_timeout(timeout)
                .with_max_iterations(iterations);

            let minimized = minimizer.minimize(&input)?;
            std::fs::write(&output, &minimized)?;

            println!("Minimized size: {} bytes", minimized.len());
            println!("Reduction: {:.1}%", 
                (1.0 - minimized.len() as f64 / input.len() as f64) * 100.0);
            println!("Saved to: {}", output.display());
        }

        Commands::Statemachine {
            session,
            output,
            json,
            min_count,
        } => {
            println!("State Machine Inference");
            println!("=======================");
            println!("Session dir: {}", session.display());
            println!("Output: {}", output.display());
            println!();

            let analyzer = SessionAnalyzer::new(&session.to_string_lossy());
            let mut fsm = analyzer.build_state_machine()?;

            if let Some(min) = min_count {
                fsm.prune_infrequent(min);
            }

            if json {
                fsm.save(&output)?;
                println!("State machine saved as JSON");
            } else {
                fsm.export_dot(&output)?;
                println!("State machine saved as DOT graph");
            }

            let stats = fsm.stats();
            println!();
            println!("Statistics:");
            println!("  States: {}", stats.num_states);
            println!("  Transitions: {}", stats.num_transitions);
            println!("  Accept states: {}", stats.num_accept_states);
        }

        Commands::Extract {
            pcap,
            output,
            protocol,
            min_length,
            max_length,
        } => {
            println!("PCAP Seed Extractor");
            println!("===================");
            println!("PCAP file: {}", pcap.display());
            println!("Output dir: {}", output.display());
            println!();

            let mut extractor = PcapExtractor::new()
                .with_min_length(min_length)
                .with_max_length(max_length);

            if let Some(proto) = protocol {
                extractor = extractor.with_protocol(proto);
            }

            let count = extractor.extract_to_dir(&pcap, &output)?;

            println!("Extracted {} seeds", count);
            println!("Saved to: {}", output.display());
        }

        Commands::Analyze {
            crashes,
            output,
            summary_only,
        } => {
            println!("Crash Analyzer");
            println!("==============");
            println!("Crash dir: {}", crashes.display());
            println!("Output dir: {}", output.display());
            println!();

            let mut analyzer = CrashAnalyzer::new(&output);
            let count = analyzer.analyze_directory(&crashes)?;

            println!("Analyzed {} crashes", count);

            let summary = analyzer.generate_summary()?;
            println!();
            println!("{}", summary);

            if !summary_only {
                let saved = analyzer.save_all()?;
                println!("Saved {} unique crashes to: {}", saved, output.display());
            }

            let summary_file = output.join("summary.txt");
            std::fs::write(&summary_file, summary)?;
            println!("Summary saved to: {}", summary_file.display());
        }

        Commands::Corpus {
            input,
            list,
            stats,
        } => {
            let mut seed_manager = SeedManager::new(&input, "/tmp/corpus")?;
            let count = seed_manager.load_seeds()?;

            println!("Corpus Manager");
            println!("==============");
            println!("Corpus dir: {}", input.display());
            println!("Total seeds: {}", count);
            println!();

            if list {
                println!("Seeds:");
                for (i, seed) in seed_manager.seeds().iter().enumerate() {
                    println!("  {:3}. {} ({} bytes)", i + 1, seed.filename, seed.length);
                }
            }

            if stats {
                let total_size: usize = seed_manager.seeds().iter().map(|s| s.length).sum();
                let min_size = seed_manager.seeds().iter().map(|s| s.length).min().unwrap_or(0);
                let max_size = seed_manager.seeds().iter().map(|s| s.length).max().unwrap_or(0);
                let avg_size = if count > 0 { total_size / count } else { 0 };

                println!();
                println!("Statistics:");
                println!("  Total size: {} bytes", total_size);
                println!("  Min size: {} bytes", min_size);
                println!("  Max size: {} bytes", max_size);
                println!("  Avg size: {} bytes", avg_size);
            }
        }
    }

    Ok(())
}
