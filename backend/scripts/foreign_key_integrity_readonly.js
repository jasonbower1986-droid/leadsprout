const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

function invalidContract() {
  const error = new Error('FOREIGN_KEY_CONTRACT_INVALID');
  error.code = 'FOREIGN_KEY_CONTRACT_INVALID';
  throw error;
}

function requireIdentifier(value) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) invalidContract();
  return value;
}

function quoteIdentifier(value) {
  return `"${requireIdentifier(value)}"`;
}

function requireTables(contract) {
  if (!contract || typeof contract !== 'object' || !contract.tables ||
      typeof contract.tables !== 'object' || Array.isArray(contract.tables)) {
    invalidContract();
  }
  return contract.tables;
}

function tableColumns(table) {
  if (!table || !Array.isArray(table.columns)) invalidContract();
  const names = table.columns.map(column => {
    if (!Array.isArray(column) || column.length < 1) invalidContract();
    return requireIdentifier(column[0]);
  });
  const columns = new Set(names);
  if (columns.size !== names.length) invalidContract();
  return columns;
}

function buildForeignKeyViolationCheck(contract, predecessorContract) {
  const tables = requireTables(contract);
  const predecessorTables = predecessorContract === undefined
    ? Object.freeze({})
    : requireTables(predecessorContract);

  const relationships = [];
  for (const childTable of Object.keys(tables).sort()) {
    requireIdentifier(childTable);
    const table = tables[childTable];
    if (!table || !Array.isArray(table.columns) || !Array.isArray(table.foreignKeys)) {
      invalidContract();
    }
    const childColumns = tableColumns(table);
    const grouped = new Map();
    for (const foreignKey of table.foreignKeys) {
      if (!Array.isArray(foreignKey) || foreignKey.length !== 8) invalidContract();
      const [id, sequence, parentTable, childColumn, parentColumn,
        onUpdate, onDelete, match] = foreignKey;
      if (!Number.isInteger(id) || id < 0 ||
          !Number.isInteger(sequence) || sequence < 0 ||
          !childColumns.has(requireIdentifier(childColumn)) ||
          !['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT']
            .includes(onUpdate) ||
          !['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT']
            .includes(onDelete) ||
          match !== 'NONE') {
        invalidContract();
      }
      requireIdentifier(parentTable);
      const parent = tables[parentTable] || predecessorTables[parentTable];
      const parentColumns = tableColumns(parent);
      if (!parentColumns.has(requireIdentifier(parentColumn))) invalidContract();

      if (!grouped.has(id)) {
        grouped.set(id, {
          childTable,
          parentTable,
          onUpdate,
          onDelete,
          match,
          columns: []
        });
      }
      const relationship = grouped.get(id);
      if (relationship.parentTable !== parentTable ||
          relationship.onUpdate !== onUpdate ||
          relationship.onDelete !== onDelete || relationship.match !== match) {
        invalidContract();
      }
      relationship.columns.push({ sequence, childColumn, parentColumn });
    }

    for (const relationship of grouped.values()) {
      relationship.columns.sort((left, right) => left.sequence - right.sequence);
      if (relationship.columns.length === 0 ||
          relationship.columns.some((column, index) => column.sequence !== index)) {
        invalidContract();
      }
      const childMembers = new Set(
        relationship.columns.map(column => column.childColumn)
      );
      const parentMembers = new Set(
        relationship.columns.map(column => column.parentColumn)
      );
      if (childMembers.size !== relationship.columns.length ||
          parentMembers.size !== relationship.columns.length) {
        invalidContract();
      }
      relationships.push(relationship);
    }
  }

  relationships.sort((left, right) => {
    const leftKey = JSON.stringify(left);
    const rightKey = JSON.stringify(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  if (relationships.length === 0) invalidContract();
  const terms = relationships.map(relationship => {
    const present = relationship.columns.map(column =>
      `child.${quoteIdentifier(column.childColumn)} IS NOT NULL`).join(' AND ');
    const matches = relationship.columns.map(column =>
      `parent.${quoteIdentifier(column.parentColumn)} = ` +
      `child.${quoteIdentifier(column.childColumn)}`).join(' AND ');
    return `(SELECT COUNT(*) FROM ${quoteIdentifier(relationship.childTable)} AS child ` +
      `WHERE ${present} AND NOT EXISTS (SELECT 1 FROM ` +
      `${quoteIdentifier(relationship.parentTable)} AS parent WHERE ${matches}))`;
  });
  return Object.freeze({
    relationship_count: relationships.length,
    sql: `SELECT ${terms.join(' + ')} AS foreign_key_violation_count`
  });
}

module.exports = {
  buildForeignKeyViolationCheck
};
