MATCH (n) DETACH DELETE n;

CREATE (:orders {id: 1, total: 10, status: 'paid', region: 'Europe', note: 'first'});
CREATE (:orders {id: 2, total: 25, status: 'paid', region: 'Europe'});
CREATE (:orders {id: 3, total: 5, status: 'open', region: 'Asia Pacific', note: 'third'});
CREATE (:orders {id: 4, total: 40, status: 'paid', region: 'North America'});

MATCH (order:orders {id: 1})
CREATE (:customers {name: 'Ada', `bad name`: 'hidden'})-[:PLACED {channel: 'web', amount: 10}]->(order);

MATCH (order:orders {id: 2})
CREATE (:customers {name: 'Bea'})-[:PLACED {channel: 'app', amount: 25}]->(order);

CREATE (:`Not Valid` {ok: 1});

CREATE (:revenue {month: '2026-01', amount: 10});
CREATE (:revenue {month: '2026-02', amount: 20});
CREATE (:revenue {month: '2026-03', amount: 15});
