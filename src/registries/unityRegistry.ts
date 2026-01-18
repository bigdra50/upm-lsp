/**
 * Unity Official Registry Client
 * Endpoint: https://packages.unity.com
 */

import { NpmRegistryClient } from "./registryClient";

/**
 * Unity Official Registry (packages.unity.com)
 */
export class UnityRegistryClient extends NpmRegistryClient {
  readonly name = "Unity Registry";
  protected readonly baseUrl = "https://packages.unity.com";
}
