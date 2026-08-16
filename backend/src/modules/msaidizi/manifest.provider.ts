/**
 * Holds the capability manifest for the process.
 *
 * Built once at module init: extraction walks every controller and reads their
 * metadata, which is cheap but not free, and the routing table cannot change at
 * runtime. Rebuilding per request would add latency for a result that is
 * identical every time.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Capability, extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';

@Injectable()
export class ManifestProvider implements OnModuleInit {
  private readonly logger = new Logger(ManifestProvider.name);
  private manifest: Capability[] = [];

  onModuleInit(): void {
    this.manifest = extractCapabilities(loadAllControllers());
    const byTier = this.manifest.reduce<Record<string, number>>((acc, c) => {
      acc[c.tier] = (acc[c.tier] ?? 0) + 1;
      return acc;
    }, {});
    this.logger.log(
      `Capability manifest: ${this.manifest.length} endpoints ` +
        `(green ${byTier.green ?? 0}, amber ${byTier.amber ?? 0}, red ${byTier.red ?? 0}).`,
    );
  }

  capabilities(): Capability[] {
    return this.manifest;
  }

  /** Test seam — lets a spec supply a manifest without booting the app. */
  setForTesting(capabilities: Capability[]): void {
    this.manifest = capabilities;
  }
}
