// Lets `tsc -p panelflow/tsconfig.json` resolve the style side-effect import that the
// real PanelSet does (`import '...panelset.scss'`) when a phase-5 test imports it.
declare module '*.scss';
declare module '*.css';
