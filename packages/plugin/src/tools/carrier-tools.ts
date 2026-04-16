import type { SidecarClient, CarrierReadResponse, CarrierMergeResponse } from "../utils/sidecar-client.js";

// ---------------------------------------------------------------------------
// carrier_read
// ---------------------------------------------------------------------------

export interface CarrierReadInput {
  agentId: string;
  projectId?: string;
  files?: string[];
}

export function createCarrierRead(client: SidecarClient) {
  return async function carrierRead(input: CarrierReadInput): Promise<CarrierReadResponse> {
    return client.carrierRead({
      agentId: input.agentId,
      projectId: input.projectId,
      files: input.files
    });
  };
}

// ---------------------------------------------------------------------------
// carrier_merge
// ---------------------------------------------------------------------------

export interface CarrierMergeInput {
  agentId: string;
  projectId?: string;
  patches: Array<{ filename: string; content: string }>;
}

export function createCarrierMerge(client: SidecarClient) {
  return async function carrierMerge(input: CarrierMergeInput): Promise<CarrierMergeResponse> {
    return client.carrierMerge({
      agentId: input.agentId,
      projectId: input.projectId,
      patches: input.patches
    });
  };
}
