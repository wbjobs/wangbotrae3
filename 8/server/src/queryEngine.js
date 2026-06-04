export class SQLParser {
  static parse(sql) {
    const upperSql = sql.toUpperCase().trim();
    
    const result = {
      type: 'select',
      columns: [],
      from: null,
      joins: [],
      where: null,
      groupBy: [],
      aggregations: [],
      isAggregate: false,
    };

    const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
    if (!selectMatch) throw new Error('Invalid SELECT statement');
    
    const columnsPart = selectMatch[1];
    const columns = this.parseColumns(columnsPart);
    result.columns = columns.regular;
    result.aggregations = columns.aggregations;
    result.isAggregate = columns.aggregations.length > 0;

    const fromMatch = sql.match(/FROM\s+(\w+)/i);
    if (fromMatch) result.from = fromMatch[1];

    const joinRegex = /(JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|INNER\s+JOIN)\s+(\w+)\s+ON\s+([^ ]+)\s*=\s*([^ ]+)/gi;
    let joinMatch;
    while ((joinMatch = joinRegex.exec(sql)) !== null) {
      result.joins.push({
        type: joinMatch[1].toUpperCase(),
        table: joinMatch[2],
        leftKey: joinMatch[3],
        rightKey: joinMatch[4],
      });
    }

    const whereMatch = sql.match(/WHERE\s+(.+?)(?:GROUP|ORDER|LIMIT|$)/i);
    if (whereMatch) result.where = this.parseCondition(whereMatch[1].trim());

    const groupByMatch = sql.match(/GROUP\s+BY\s+(.+?)(?:ORDER|LIMIT|$)/i);
    if (groupByMatch) {
      result.groupBy = groupByMatch[1].split(',').map(s => s.trim());
      result.isAggregate = true;
    }

    return result;
  }

  static parseColumns(columnsPart) {
    const columns = columnsPart.split(',').map(s => s.trim());
    const regular = [];
    const aggregations = [];
    const aggRegex = /(COUNT|SUM|AVG|MIN|MAX)\s*\(\s*(.+?)\s*\)/i;

    for (const col of columns) {
      const aggMatch = col.match(aggRegex);
      if (aggMatch) {
        aggregations.push({
          function: aggMatch[1].toUpperCase(),
          column: aggMatch[2] === '*' ? null : aggMatch[2],
          alias: col,
        });
      } else if (col === '*') {
        regular.push('*');
      } else {
        const aliasMatch = col.match(/(.+?)\s+AS\s+(.+)/i);
        if (aliasMatch) {
          regular.push({ name: aliasMatch[1], alias: aliasMatch[2] });
        } else {
          regular.push(col);
        }
      }
    }

    return { regular, aggregations };
  }

  static parseCondition(conditionStr) {
    conditionStr = conditionStr.trim();
    
    const orParts = conditionStr.split(/\s+OR\s+/i);
    if (orParts.length > 1) {
      return {
        type: 'or',
        conditions: orParts.map(p => this.parseCondition(p.trim())),
      };
    }

    const andParts = conditionStr.split(/\s+AND\s+/i);
    if (andParts.length > 1) {
      return {
        type: 'and',
        conditions: andParts.map(p => this.parseCondition(p.trim())),
      };
    }

    const opMatch = conditionStr.match(/([^ ]+)\s*(=|!=|<>|>|<|>=|<=|LIKE|IN)\s*(.+)/i);
    if (opMatch) {
      const value = this.parseValue(opMatch[3]);
      return {
        type: 'comparison',
        left: opMatch[1],
        operator: opMatch[2].toUpperCase(),
        right: value,
      };
    }

    return null;
  }

  static parseValue(valueStr) {
    valueStr = valueStr.trim();
    
    if (valueStr.startsWith("'") || valueStr.startsWith('"')) {
      return valueStr.slice(1, -1);
    }
    
    if (valueStr.toUpperCase() === 'NULL') {
      return null;
    }
    
    if (valueStr.toUpperCase() === 'TRUE') {
      return true;
    }
    
    if (valueStr.toUpperCase() === 'FALSE') {
      return false;
    }
    
    const num = Number(valueStr);
    if (!isNaN(num)) {
      return num;
    }

    return valueStr;
  }
}

export class QueryExecutor {
  constructor(pool) {
    this.pool = pool;
  }

  async executeQuery(ast, tableId) {
    const columns = await this.getTableColumns(tableId);
    const rows = await this.getTableRows(tableId);
    
    if (rows.length === 0) {
      return { data: [], affectedColumns: [] };
    }

    const data = rows.map(row => this.rowToObject(row, columns));

    let result = data;

    if (ast.where) {
      result = result.filter(row => this.evaluateCondition(ast.where, row));
    }

    if (ast.joins && ast.joins.length > 0) {
      for (const join of ast.joins) {
        result = await this.performJoin(result, join);
      }
    }

    if (ast.isAggregate || ast.aggregations.length > 0) {
      result = this.performAggregation(result, ast);
    } else if (!ast.columns.includes('*')) {
      result = result.map(row => this.projectColumns(row, ast.columns));
    }

    const affectedColumns = new Set();
    columns.forEach(c => affectedColumns.add(c.name));
    if (ast.where) {
      this.collectAffectedColumns(ast.where, affectedColumns);
    }

    return {
      data: result,
      affectedColumns: Array.from(affectedColumns),
    };
  }

  async getTableColumns(tableId) {
    const result = await this.pool.query(
      'SELECT id, name, type FROM columns WHERE table_id = $1 ORDER BY position',
      [tableId]
    );
    return result.rows;
  }

  async getTableRows(tableId) {
    const result = await this.pool.query(`
      SELECT r.id,
             json_object_agg(c.name, cl.value) as data
      FROM rows r
      LEFT JOIN cells cl ON cl.row_id = r.id
      LEFT JOIN columns c ON c.id = cl.column_id
      WHERE r.table_id = $1 AND r.is_deleted = FALSE
      GROUP BY r.id
    `, [tableId]);
    return result.rows;
  }

  rowToObject(row, columns) {
    const obj = { _id: row.id };
    for (const col of columns) {
      const value = row.data?.[col.name];
      if (value !== undefined && value !== null) {
        if (col.type === 'number' && value !== null) {
          obj[col.name] = Number(value);
        } else {
          obj[col.name] = value;
        }
      } else {
        obj[col.name] = null;
      }
    }
    return obj;
  }

  evaluateCondition(condition, row) {
    if (!condition) return true;

    switch (condition.type) {
      case 'and':
        return condition.conditions.every(c => this.evaluateCondition(c, row));
      case 'or':
        return condition.conditions.some(c => this.evaluateCondition(c, row));
      case 'comparison':
        return this.evaluateComparison(condition, row);
      default:
        return true;
    }
  }

  evaluateComparison(comp, row) {
    const leftValue = row[comp.left];
    const rightValue = comp.right;

    switch (comp.operator) {
      case '=':
        return leftValue === rightValue;
      case '!=':
      case '<>':
        return leftValue !== rightValue;
      case '>':
        return leftValue > rightValue;
      case '<':
        return leftValue < rightValue;
      case '>=':
        return leftValue >= rightValue;
      case '<=':
        return leftValue <= rightValue;
      case 'LIKE': {
        const pattern = String(rightValue).replace(/%/g, '.*');
        return new RegExp(`^${pattern}$`, 'i').test(String(leftValue));
      }
      case 'IN': {
        const values = Array.isArray(rightValue) ? rightValue : [rightValue];
        return values.includes(leftValue);
      }
      default:
        return false;
    }
  }

  async performJoin(data, join) {
    const joinedTable = await this.findTableByName(join.table);
    if (!joinedTable) return data;

    const joinedColumns = await this.getTableColumns(joinedTable.id);
    const joinedRows = await this.getTableRows(joinedTable.id);
    const joinedData = joinedRows.map(row => this.rowToObject(row, joinedColumns));
    const joinedMap = new Map();
    for (const jrow of joinedData) {
      const key = jrow[join.rightKey.split('.').pop()];
      if (!joinedMap.has(key)) joinedMap.set(key, []);
      joinedMap.get(key).push(jrow);
    }

    const result = [];
    const leftKey = join.leftKey.split('.').pop();

    for (const row of data) {
      const matches = joinedMap.get(row[leftKey]) || [];
      if (matches.length === 0 && join.type.includes('LEFT')) {
        result.push({ ...row });
      } else {
        for (const match of matches) {
          result.push({ ...row, ...match });
        }
      }
    }

    return result;
  }

  async findTableByName(name) {
    const result = await this.pool.query(
      'SELECT id FROM tables WHERE name = $1 LIMIT 1',
      [name]
    );
    return result.rows[0] || null;
  }

  performAggregation(data, ast) {
    const groups = new Map();
    const groupKeys = ast.groupBy || ['__all__'];

    for (const row of data) {
      const groupKey = groupKeys[0] === '__all__' 
        ? '__all__' 
        : groupKeys.map(k => row[k]).join('|');
      
      if (!groups.has(groupKey)) {
        groups.set(groupKey, { rows: [], values: {} });
      }
      groups.get(groupKey).rows.push(row);
    }

    const results = [];
    for (const [key, group] of groups) {
      const resultRow = {};

      if (groupKeys[0] !== '__all__') {
        const keyParts = key.split('|');
        for (let i = 0; i < groupKeys.length; i++) {
          resultRow[groupKeys[i]] = keyParts[i];
        }
      }

      for (const agg of ast.aggregations) {
        resultRow[agg.alias] = this.calculateAggregation(group.rows, agg);
      }

      results.push(resultRow);
    }

    return results;
  }

  calculateAggregation(rows, agg) {
    switch (agg.function) {
      case 'COUNT':
        if (agg.column === null) {
          return rows.length;
        }
        return rows.filter(r => r[agg.column] !== null && r[agg.column] !== undefined).length;
      
      case 'SUM':
        return rows
          .filter(r => r[agg.column] !== null && !isNaN(Number(r[agg.column])))
          .reduce((sum, r) => sum + Number(r[agg.column]), 0);
      
      case 'AVG': {
        const validRows = rows.filter(r => r[agg.column] !== null && !isNaN(Number(r[agg.column])));
        if (validRows.length === 0) return null;
        return validRows.reduce((sum, r) => sum + Number(r[agg.column]), 0) / validRows.length;
      }
      
      case 'MIN': {
        const values = rows
          .filter(r => r[agg.column] !== null && r[agg.column] !== undefined)
          .map(r => r[agg.column]);
        return values.length > 0 ? Math.min(...values.map(v => Number(v) || 0)) : null;
      }
      
      case 'MAX': {
        const values = rows
          .filter(r => r[agg.column] !== null && r[agg.column] !== undefined)
          .map(r => r[agg.column]);
        return values.length > 0 ? Math.max(...values.map(v => Number(v) || 0)) : null;
      }
      
      default:
        return null;
    }
  }

  projectColumns(row, columns) {
    const result = {};
    for (const col of columns) {
      if (typeof col === 'string') {
        if (col === '*') return row;
        result[col] = row[col];
      } else {
        result[col.alias || col.name] = row[col.name];
      }
    }
    return result;
  }

  collectAffectedColumns(condition, columns) {
    if (condition.type === 'and' || condition.type === 'or') {
      condition.conditions.forEach(c => this.collectAffectedColumns(c, columns));
    } else if (condition.type === 'comparison') {
      columns.add(condition.left);
    }
  }

  async computeIncrementalUpdate(view, changes) {
    const ast = view.query_ast;
    const columns = await this.getTableColumns(view.table_id);
    
    const affectedRows = new Set();
    const modifiedColumns = new Set();

    for (const change of changes) {
      if (change.rowId) affectedRows.add(change.rowId);
      if (change.columnId) {
        const col = columns.find(c => c.id === change.columnId);
        if (col) modifiedColumns.add(col.name);
      }
    }

    if (view.materialized_view && view.materialized_view.data) {
      const relevantChanges = view.affected_columns.some(c => modifiedColumns.has(c));
      
      if (!relevantChanges && !ast.isAggregate) {
        const changedRowsResult = await this.pool.query(`
          SELECT r.id,
                 json_object_agg(c.name, cl.value) as data
          FROM rows r
          LEFT JOIN cells cl ON cl.row_id = r.id
          LEFT JOIN columns c ON c.id = cl.column_id
          WHERE r.id = ANY($1) AND r.is_deleted = FALSE
          GROUP BY r.id
        `, [Array.from(affectedRows)]);

        const updatedRows = changedRowsResult.rows.map(r => this.rowToObject(r, columns));
        const filteredUpdated = updatedRows.filter(row => this.evaluateCondition(ast.where, row));
        
        const currentData = view.materialized_view.data;
        const idsToRemove = Array.from(affectedRows);
        const newData = currentData.filter(r => !idsToRemove.includes(r._id));
        
        for (const row of filteredUpdated) {
          newData.push(this.projectColumns(row, ast.columns));
        }

        return {
          type: 'incremental',
          data: newData,
          updated: filteredUpdated,
          removed: idsToRemove,
        };
      }
    }

    const fullResult = await this.executeQuery(ast, view.table_id);
    return {
      type: 'full',
      data: fullResult.data,
    };
  }
}

export default QueryExecutor;
