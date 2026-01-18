/**
 * OpenUPM Registry Client
 * Endpoint: https://package.openupm.com
 */

import { NpmRegistryClient } from "./registryClient";

/**
 * OpenUPM Registry (package.openupm.com)
 */
export class OpenUpmRegistryClient extends NpmRegistryClient {
  readonly name = "OpenUPM";
  protected readonly baseUrl = "https://package.openupm.com";
}
