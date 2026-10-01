const neo4j = require('neo4j-driver');
const uri = 'bolt://localhost:7687';
const user = 'neo4j';
const password = 'mentorqa_neo4j';
const neo4jDriver = neo4j.driver(uri, neo4j.auth.basic(user, password));

async function main() {
  const session = neo4jDriver.session();
  try {
    const repositoryId = 'cmtulqlkk0002vacgm9tmebf0';
    const nodesRes = await session.run(
      `MATCH (n:Node {repositoryId: $repositoryId}) RETURN properties(n) AS node`,
      { repositoryId }
    );
    
    const edgesRes = await session.run(
      `MATCH (s:Node {repositoryId: $repositoryId})-[r]->(t:Node {repositoryId: $repositoryId}) 
       RETURN s.id AS source, t.id AS target, type(r) AS relationship`,
      { repositoryId }
    );
    
    const nodes = nodesRes.records.map(r => r.get('node'));
    const edges = edgesRes.records.map(r => ({
      source: r.get('source'),
      target: r.get('target'),
      relationship: r.get('relationship')
    }));
    
    console.log("nodes length:", nodes.length);
    console.log("edges length:", edges.length);
    console.log(JSON.stringify({ nodes: nodes.slice(0, 2), edges: edges.slice(0, 2) }, null, 2));
  } finally {
    await session.close();
    await neo4jDriver.close();
  }
}
main().catch(console.error);
