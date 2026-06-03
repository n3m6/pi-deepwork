// StateReconstruction — re-exports from the infrastructure fs adapter.
// The implementation lives in infrastructure/fs/state-reconstruction.ts because
// it reads the filesystem directly; only port-based code may live in application/.

// eslint-disable-next-line no-restricted-imports -- re-export shim; implementation requires fs, so it lives in infrastructure
export { resumeOrInferState, inferStateFromArtifacts } from "../../infrastructure/fs/state-reconstruction.js";
