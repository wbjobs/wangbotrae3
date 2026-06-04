pub mod formats;
pub mod structure;
pub mod structure_propagation;
pub mod symbolic;
pub mod autodiff;
pub mod io;

pub use formats::{CooMatrix, CsrMatrix, CscMatrix, SparseMatrix};
pub use structure::{MatrixStructure, detect_structure};
pub use structure_propagation::{
    MatrixExpr, StructureNode, StructureDerivationTree, StructureConstraint,
    ConstraintViolation, OptimizationSuggestion,
    propagate_structure, build_derivation_tree, verify_constraints,
    generate_suggestions, format_structure, format_constraint, print_derivation_tree,
};
pub use symbolic::{SymbolicMatrix, SymbolicExpression, ExprRegistry, ExprId, ExprKind};
pub use autodiff::{
    SparsityPattern, jacobian_sparsity, hessian_sparsity,
    CompositeFunction, CompositeLayer,
    check_explosion_risk, ExplosionRiskReport, RiskLevel,
};
pub use io::{save_json, save_dot, load_matrix_market};
