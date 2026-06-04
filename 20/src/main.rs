mod coverage;
mod seed;
mod mutator;
mod statemachine;
mod crash;
mod cli;
mod fuzzer;

use cli::run_cli;
use anyhow::Result;

fn main() -> Result<()> {
    run_cli()?;
    Ok(())
}
