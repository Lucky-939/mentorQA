/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-empty, prefer-const */
import neo4j, { Driver, Session } from 'neo4j-driver';
import crypto from 'crypto';

let driver: Driver | null = null;

export function getNeo4jDriver(): Driver {
  if (!driver) {
    const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
    const user = process.env.NEO4J_USER || 'neo4j';
    const password = process.env.NEO4J_PASSWORD || 'mentorqa_neo4j';
    
    driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }
  return driver;
}

export async function storeGraph(repositoryId: string, nodes: any[], edges: any[]) {
  const drv = getNeo4jDriver();
  const session = drv.session();
  
  try {
    // Clear previous graph for this repository
    await session.run(`
      MATCH (n:Node {repositoryId: $repositoryId})
      DETACH DELETE n
    `, { repositoryId });

    // Insert Nodes
    for (const node of nodes) {
      await session.run(`
        MERGE (n:Node {
          id: $id,
          repositoryId: $repositoryId
        })
        SET n.name = $name, n.type = $type, n.file = $file, n.layer = $layer
      `, { ...node, repositoryId });
    }

    // Insert Edges
    for (const edge of edges) {
      const relType = edge.relationship.toUpperCase();
      
      if (['IMPORTS', 'CALLS', 'EXTENDS'].includes(relType)) {
        await session.run(`
          MATCH (source:Node {id: $source, repositoryId: $repositoryId})
          MATCH (target:Node {id: $target, repositoryId: $repositoryId})
          MERGE (source)-[:${relType}]->(target)
        `, { source: edge.source, target: edge.target, repositoryId });
      }
    }
  } finally {
    await session.close();
  }
}

export async function detectArchitecturalFlaws(repositoryId: string) {
  const drv = getNeo4jDriver();
  const session = drv.session();
  const findings: any[] = [];
  
  try {
    // 1. Detect Circular Dependencies (up to depth 5 for performance)
    const cycleRes = await session.run(`
      MATCH path=(n:Node {repositoryId: $repositoryId})-[:IMPORTS*1..5]->(n)
      RETURN nodes(path) AS cycleNodes
      LIMIT 10
    `, { repositoryId });

    const seenCycles = new Set<string>();
    for (const record of cycleRes.records) {
      const cycleNodes = record.get('cycleNodes').map((n: any) => n.properties.name);
      
      // Deduplicate by creating a canonical sorted representation of the cycle
      const uniqueNodes = [...cycleNodes.slice(0, -1)].sort();
      const canonical = uniqueNodes.join(',');
      
      if (seenCycles.has(canonical)) continue;
      seenCycles.add(canonical);

      findings.push({
        id: crypto.randomUUID(),
        category: "architecture",
        severity: "high",
        file: record.get('cycleNodes')[0].properties.file,
        lineStart: 0,
        lineEnd: 0,
        message: `Circular dependency detected: ${cycleNodes.join(' -> ')}`,
        ruleId: "circular-dependency",
      });
    }

    // 2. God Classes
    const statsRes = await session.run(`
      MATCH (n:Node {repositoryId: $repositoryId})
      OPTIONAL MATCH (n)-[r]-()
      WITH n, count(r) AS degree
      WITH avg(degree) AS avgDegree, stDev(degree) AS stdDevDegree
      RETURN coalesce(avgDegree, 0) AS avgDegree, coalesce(stdDevDegree, 0) AS stdDevDegree
    `, { repositoryId });
    
    if (statsRes.records.length > 0) {
      const avg = statsRes.records[0].get('avgDegree');
      const stddev = statsRes.records[0].get('stdDevDegree');
      const threshold = avg + (2 * stddev);
      
      const godClassesRes = await session.run(`
        MATCH (n:Node {repositoryId: $repositoryId})
        OPTIONAL MATCH (n)-[r]-()
        WITH n, count(r) AS degree
        WHERE degree > $threshold AND degree > 5
        RETURN n.properties.name AS name, n.properties.file AS file, degree
      `, { repositoryId, threshold });

      for (const record of godClassesRes.records) {
        findings.push({
          id: crypto.randomUUID(),
          category: "architecture",
          severity: "medium",
          file: record.get('file'),
          lineStart: 0,
          lineEnd: 0,
          message: `God class detected: ${record.get('name')} has unusually high coupling (degree ${record.get('degree')} vs repo average ${avg.toFixed(1)}).`,
          ruleId: "god-class",
        });
      }
    }

    // 3. Layering Violations
    const layerRes = await session.run(`
      MATCH (c:Node {repositoryId: $repositoryId, layer: 'controller'})-[:CALLS|IMPORTS]->(r:Node {repositoryId: $repositoryId, layer: 'repository'})
      RETURN c.name AS controller, c.file AS file, r.name AS repository
    `, { repositoryId });

    for (const record of layerRes.records) {
      findings.push({
        id: crypto.randomUUID(),
        category: "architecture",
        severity: "medium",
        file: record.get('file'),
        lineStart: 0,
        lineEnd: 0,
        message: `Layering violation: Controller ${record.get('controller')} directly accesses repository ${record.get('repository')}, bypassing the service layer.`,
        ruleId: "layering-violation",
      });
    }
  } finally {
    await session.close();
  }

  return findings;
}
