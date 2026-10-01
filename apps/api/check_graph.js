const neo4j = require('neo4j-driver');

async function main() {
  const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'mentorqa_neo4j'));
  const session = driver.session();
  try {
    const repoId = 'cmulu4h2d0001vabck3q4xyxw';
    const resNodes = await session.run(`MATCH (n:Node {repositoryId: $repoId}) RETURN properties(n) AS node`, { repoId });
    console.log('--- NODES ---');
    resNodes.records.forEach(r => console.log(r.get('node')));

    const resEdges = await session.run(`MATCH (s:Node {repositoryId: $repoId})-[r]->(t:Node {repositoryId: $repoId}) RETURN s.id AS source, t.id AS target, type(r) AS rel`, { repoId });
    console.log('--- EDGES ---');
    resEdges.records.forEach(r => console.log(r.get('source'), '->', r.get('target'), '(', r.get('rel'), ')'));
  } finally {
    await session.close();
    await driver.close();
  }
}
main().catch(console.error);
