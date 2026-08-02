const assert = require('assert');
const {
  buildForeignKeyViolationCheck
} = require('./backend/scripts/foreign_key_integrity_readonly');

function column(name) {
  return [name, 'TEXT', 1, null, 0];
}

function contract(foreignKeys, parentColumn = 'id') {
  return {
    tables: {
      child: {
        columns: [column('left_id'), column('right_id')],
        foreignKeys
      },
      parent: {
        columns: [column(parentColumn)],
        foreignKeys: []
      }
    }
  };
}

function foreignKey(overrides = {}) {
  return [
    overrides.id ?? 0,
    overrides.sequence ?? 0,
    overrides.parentTable ?? 'parent',
    overrides.childColumn ?? 'left_id',
    overrides.parentColumn ?? 'id',
    overrides.onUpdate ?? 'NO ACTION',
    overrides.onDelete ?? 'RESTRICT',
    overrides.match ?? 'NONE'
  ];
}

function rejects(value) {
  assert.throws(
    value,
    error => error?.code === 'FOREIGN_KEY_CONTRACT_INVALID'
  );
}

const simple = buildForeignKeyViolationCheck(contract([foreignKey()]));
assert.strictEqual(simple.relationship_count, 1);
assert.strictEqual(
  simple.sql,
  'SELECT (SELECT COUNT(*) FROM "child" AS child WHERE ' +
  'child."left_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "parent" AS parent ' +
  'WHERE parent."id" = child."left_id")) AS foreign_key_violation_count'
);

const composite = buildForeignKeyViolationCheck({
  tables: {
    child: {
      columns: [column('left_id'), column('right_id')],
      foreignKeys: [
        foreignKey(),
        foreignKey({ sequence: 1, childColumn: 'right_id', parentColumn: 'right_id' })
      ]
    },
    parent: {
      columns: [column('id'), column('right_id')],
      foreignKeys: []
    }
  }
});
assert.strictEqual(composite.relationship_count, 1);
assert(composite.sql.includes(
  'child."left_id" IS NOT NULL AND child."right_id" IS NOT NULL'
));
assert(composite.sql.includes(
  'parent."id" = child."left_id" AND parent."right_id" = child."right_id"'
));

const external = {
  tables: {
    child: {
      columns: [column('left_id'), column('right_id')],
      foreignKeys: [foreignKey({ parentTable: 'base_parent' })]
    }
  }
};
rejects(() => buildForeignKeyViolationCheck(external));
assert.strictEqual(buildForeignKeyViolationCheck(external, {
  tables: { base_parent: { columns: [column('id')] } }
}).relationship_count, 1);

rejects(() => buildForeignKeyViolationCheck(contract([])));
rejects(() => buildForeignKeyViolationCheck(contract([
  foreignKey({ childColumn: 'missing' })
])));
rejects(() => buildForeignKeyViolationCheck(contract([
  foreignKey({ parentColumn: 'missing' })
])));
rejects(() => buildForeignKeyViolationCheck(contract([
  foreignKey({ match: 'FULL' })
])));
rejects(() => buildForeignKeyViolationCheck(contract([
  foreignKey({ sequence: 1 })
])));
rejects(() => buildForeignKeyViolationCheck(contract([
  foreignKey(),
  foreignKey({ sequence: 1 })
])));
rejects(() => buildForeignKeyViolationCheck({
  tables: {
    'child;drop_table': {
      columns: [column('left_id')],
      foreignKeys: []
    }
  }
}));
rejects(() => buildForeignKeyViolationCheck({
  tables: {
    child: {
      columns: [column('left_id'), column('left_id')],
      foreignKeys: []
    }
  }
}));

console.log('PASS read-only foreign-key integrity query construction');
