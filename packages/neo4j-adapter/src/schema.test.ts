import { describe, expect, it } from "vitest";
import { buildSchema, graphName, labelsForNodeType, namesFromType, stringList } from "./schema.ts";

describe("graph names", () => {
  it("reads procedure tokens and skips unsafe names", () => {
    expect(graphName(":PLACED")).toBe("PLACED");
    expect(graphName("PLACED")).toBe("PLACED");
    expect(graphName(":`Not Valid`")).toBeUndefined();
    expect(graphName(":__proto__")).toBeUndefined();
    expect(graphName(":constructor")).toBeUndefined();
    expect(namesFromType(":`Person`:`Employee`")).toEqual(["Person", "Employee"]);
    expect(namesFromType(":orders")).toEqual(["orders"]);
    expect(namesFromType(":`a``b`")).toEqual([]);
    expect(labelsForNodeType([], ":revenue")).toEqual(["revenue"]);
    expect(labelsForNodeType([":orders"], null)).toEqual(["orders"]);
    expect(labelsForNodeType([], null)).toEqual([]);
    expect(stringList("no")).toEqual([]);
    expect(stringList(["id", 1, "status"])).toEqual(["id", "status"]);
  });
});

describe("buildSchema", () => {
  it("maps labels and relationship types to resources", () => {
    const resources = buildSchema({
      labels: ["orders", "Not Valid", "revenue"],
      nodeRows: [
        {
          labels: ["orders"],
          propertyName: "id",
          propertyTypes: ["Long"],
          mandatory: true,
        },
        {
          labels: ["orders"],
          propertyName: "note",
          propertyTypes: ["String"],
          mandatory: false,
        },
        {
          labels: ["orders", "Not Valid"],
          propertyName: "bad name",
          propertyTypes: ["String"],
          mandatory: false,
        },
        {
          labels: ["orders"],
          propertyName: "total",
          propertyTypes: ["Long", "String"],
          mandatory: true,
        },
        {
          labels: ["orders"],
          propertyName: "total",
          propertyTypes: ["Double"],
          mandatory: false,
        },
        {
          labels: ["orders"],
          propertyName: "flag",
          propertyTypes: [],
          mandatory: true,
        },
      ],
      relationshipTypes: [":PLACED", ":`Not Valid`"],
      relationshipRows: [
        {
          relationshipType: ":PLACED",
          propertyName: "channel",
          propertyTypes: ["String"],
          mandatory: true,
        },
        {
          relationshipType: null,
          propertyName: "ignored",
          propertyTypes: [],
          mandatory: true,
        },
        {
          relationshipType: ":PLACED",
          propertyName: null,
          propertyTypes: [],
          mandatory: true,
        },
      ],
    });

    expect(resources.map((resource) => `${resource.namespace}.${resource.name}`)).toEqual([
      "node.orders",
      "node.revenue",
      "relationship.PLACED",
    ]);
    expect(resources.find((resource) => resource.name === "orders")).toMatchObject({
      kind: "collection",
      columns: [
        { name: "flag", type: "unknown", nullable: false },
        { name: "id", type: "Long", nullable: false },
        { name: "note", type: "String", nullable: true },
        { name: "total", type: "Double|Long|String", nullable: true },
      ],
    });
    expect(resources.find((resource) => resource.name === "revenue")?.columns).toEqual([]);
    expect(resources.find((resource) => resource.name === "PLACED")?.columns).toEqual([
      { name: "channel", type: "String", nullable: false },
    ]);
  });

  it("returns at most 200 resources for one namespace", () => {
    const labels = Array.from({ length: 201 }, (_, index) => `Label${String(index).padStart(3, "0")}`);
    const resources = buildSchema({
      labels,
      nodeRows: [],
      relationshipTypes: [],
      relationshipRows: [],
    });
    expect(resources).toHaveLength(200);
    expect(resources.map((resource) => resource.name)).not.toContain("Label200");
    expect(resources[0]?.name).toBe("Label000");
  });
});
