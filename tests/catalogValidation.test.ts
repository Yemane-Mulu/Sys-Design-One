// @vitest-environment node
// KNOXNET-FIXES Req 10 Catalog_Validator: automated checks for allowed
// categories (compile-enforced by the typed catalogs), required shapes,
// finite numeric values, unique identifiers within each catalog, and
// reference resolution through the exported lookup maps.
import { describe, it, expect } from "vitest";
import {
  devices,
  devicesById,
  type DeviceCategory,
} from "../src/data/devices";
import {
  rackDevices,
  rackDevicesById,
  rackCategoryLabel,
  type RackCategory,
} from "../src/data/rackDevices";

const deviceCategories: ReadonlySet<string> = new Set<string>([
  "cameras", "access", "network", "detection", "av", "audio",
  "lighting", "production", "wireless", "broadcast", "site",
]);

describe("device catalog validation", () => {
  it("identifiers are unique within the catalog", () => {
    const ids = devices.map((d) => d.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes, `duplicate device ids: ${dupes.join(", ")}`).toEqual([]);
  });

  it("devicesById resolves every catalog record", () => {
    // The supplied catalog enriches map values with inferred ports
    // ({ ...d, ports }), so resolution is semantic, not reference-identity.
    for (const d of devices) {
      const resolved = devicesById[d.id];
      expect(resolved, d.id).toBeDefined();
      expect(resolved?.id, d.id).toBe(d.id);
      expect(resolved?.label, d.id).toBe(d.label);
    }
  });

  it("every record carries an allowed category, finite numbers, and an icon", () => {
    for (const d of devices) {
      expect(deviceCategories.has(d.category), `${d.id}: category ${d.category}`).toBe(true);
      expect(Number.isFinite(d.defaultCost), `${d.id}: defaultCost`).toBe(true);
      expect(Number.isFinite(d.laborHours), `${d.id}: laborHours`).toBe(true);
      expect(d.icon.paths.length, `${d.id}: icon paths`).toBeGreaterThan(0);
      expect(d.label.length, `${d.id}: label`).toBeGreaterThan(0);
    }
  });

  it("every id referenced by existing tests and src resolves through the lookup map", () => {
    const required = [
      "cam-dome",
      "cam-bullet",
      "net-ap-i",
      "net-switch-poe",
      "net-nid",
      "net-headend",
      "net-rack",
      "site-pullbox",
      "site-junction-box",
      "net-wifi-bridge",
    ];
    for (const id of required) {
      expect(devicesById[id], `missing referenced device: ${id}`).toBeDefined();
    }
  });

  it("labels and ports asserted by existing tests are preserved", () => {
    expect(devicesById["site-junction-box"]?.label).toBe("Junction Box");
    expect(devicesById["site-pullbox"]?.label).toBe("Pull Box");
    expect(devicesById["net-switch-poe"]?.ports?.length ?? 0).toBeGreaterThan(0);
    expect(devicesById["cam-dome"]?.category as DeviceCategory).toBe("cameras");
  });
});

describe("rack catalog validation", () => {
  it("identifiers are unique within the catalog", () => {
    const ids = rackDevices.map((d) => d.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes, `duplicate rack ids: ${dupes.join(", ")}`).toEqual([]);
  });

  it("rackDevicesById resolves every catalog record", () => {
    for (const d of rackDevices) {
      expect(rackDevicesById[d.id], d.id).toBe(d);
    }
  });

  it("every record carries a category covered by rackCategoryLabel and finite numbers", () => {
    for (const d of rackDevices) {
      expect(
        rackCategoryLabel,
        `${d.id}: no label for category ${d.category}`,
      ).toHaveProperty(d.category as RackCategory);
      expect(Number.isFinite(d.defaultCost), `${d.id}: defaultCost`).toBe(true);
      expect(Number.isFinite(d.laborHours), `${d.id}: laborHours`).toBe(true);
      expect(Number.isFinite(d.uHeight), `${d.id}: uHeight`).toBe(true);
      expect(d.label.length, `${d.id}: label`).toBeGreaterThan(0);
    }
  });

  it("retains the rack id referenced by existing tests and src/lib/nesting.ts", () => {
    expect(rackDevicesById["sw-cat-24"]).toBeDefined();
    expect(rackDevicesById["sw-cat-24"]?.category).toBe("switch");
  });
});
