'use strict';

const assert = require('assert');
const escope = require('escope');
const pipeline = require('json-pipeline');

const cfg = require('../cfg');
const Slot = cfg.Slot;

function Constructor(options) {
  this.options = options || {};
  this.scopes = null;
  this.scope = null;
  this.ast = null;
  this.pipeline = null;
  this.result = null;
  this.renamer = null;
}
module.exports = Constructor;

Constructor.prototype.build = function build(ast) {
  this.ast = ast;
  this.scopes = escope.analyze(ast, { ecmaVersion: 6 });
  this.scope = null;
  this.pipeline = null;
  this.renamer = new Map();

  const res = [];
  this.result = res;

  this.visit(ast);

  this.result = null;
  this.pipeline = null;
  this.scope = null;
  this.scopes = null;
  this.ast = null;

  return res;
};

Constructor.prototype.bind = function bind(node, ast) {
  if (!node)
    return node;

  node.data = ast;
  return node;
};

Constructor.prototype.visitList = function visitList(list) {
  assert(Array.isArray(list));
  for (let i = 0; i < list.length; i++)
    this.visit(list[i]);

  // Just in case anyone will try to use this value
  return null;
};

Constructor.prototype.visit = function visit(ast) {
  if (ast.type === 'Program')
    return this.visitProgram(ast);
  else if (ast.type === 'ExpressionStatement')
    return this.visitStmt(ast);
  else if (ast.type === 'BlockStatement')
    return this.visitBlock(ast);
  else if (ast.type === 'Identifier')
    return this.visitIdentifier(ast);
  else if (ast.type === 'Literal')
    return this.visitLiteral(ast);
  else if (ast.type === 'AssignmentExpression')
    return this.visitAssignment(ast);
  else if (ast.type === 'MemberExpression')
    return this.visitProperty(ast);
  else if (ast.type === 'VariableDeclaration')
    return this.visitVarDecl(ast);
  else
    assert(false, `Unknown AST node type: "${ast.type}"`);
};

Constructor.prototype.visitProgram = function visitProgram(ast) {
  const p = pipeline.create('cfg');

  this.pipeline = p;
  this.result.push(p);
  this.bind(p.block(), ast);

  const oldScope = this.scope;

  this.enter(ast);
  this.visitList(ast.body);
  this.scope = oldScope;

  return null;
};

Constructor.prototype.visitStmt = function visitStmt(ast) {
  this.visit(ast.expression);

  return null;
};

Constructor.prototype.visitBlock = function visitBlock(ast) {
  const oldScope = this.scope;
  this.enter(ast);
  this.visitList(ast.body);
  this.scope = oldScope;

  return null;
};

Constructor.prototype.visitIdentifier = function visitIdentifier(ast) {
  const slot = this.toSlot(ast);
  assert.equal(slot.kind, 'var');

  const ref = slot.ref;

  let res;
  if (ref.resolved === null)
    res = this.pipeline.add('loadGlobal').addLiteral(ref.identifier.name);
  else if (ref.resolved.stack)
    res = this.pipeline.add('ssa:load').addLiteral(this.rename(ref.resolved));
  else
    throw new Error('Context loads not implemented yet');

  this.bind(res, ast);
  return res;
};

Constructor.prototype.visitLiteral = function visitLiteral(ast) {
  return this.bind(this.pipeline.add('literal').addLiteral(ast.value), ast);
};

Constructor.prototype.visitAssignment = function visitAssignment(ast) {
  if (ast.operator === '=') {
    const slot = this.toSlot(ast.left);
    const right = this.visit(ast.right);

    let res;
    if (slot.kind === 'var') {
      const ref = slot.ref;

      if (ref.resolved === null) {
        res = this.pipeline.add('storeGlobal').addLiteral(ref.identifier.name);
      } else if (ref.resolved.stack) {
        res = this.pipeline.add('ssa:store')
            .addLiteral(this.rename(ref.resolved));
      } else {
        throw new Error('Context loads not implemented yet');
      }

      res.addInput(right);
    } else if (slot.kind === 'named') {
      res = this.pipeline.add('storeNamedProperty', [ slot.object, right ]);
      res.addLiteral(slot.name);
    } else {
      assert.equal(slot.kind, 'property');

      res = this.pipeline.add('storeProperty', [
          slot.object, slot.property, right ]);
    }

    this.bind(res, ast);

    return right;
  }

  throw new Error('Not implemented');
};

Constructor.prototype.visitProperty = function visitProperty(ast) {
  const slot = this.toSlot(ast);

  let res;
  if (slot.kind === 'named') {
    res = this.pipeline.add('loadNamedProperty', slot.object)
        .addLiteral(slot.name);
  } else {
    assert.equal(slot.kind, 'property');

    res = this.pipeline.add('loadProperty', [ slot.object, slot.property ]);
  }

  return this.bind(res, ast);
};

Constructor.prototype.visitVarDecl = function visitVarDecl(ast) {
  for (let i = 0; i < ast.declarations.length; i++) {
    const decl = ast.declarations[i];

    if (decl.init === null)
      continue;

    this.visit({
      loc: decl.loc,
      type: 'AssignmentExpression',
      operator: '=',
      left: decl.id,
      right: decl.init
    });
  }
};

Constructor.prototype.enter = function enter(ast) {
  const next = this.scopes.acquire(ast);
  if (!next)
    return;

  this.scope = next;

  let undef;
  let hole;

  // Initialize all scope variables
  for (let i = 0; i < next.variables.length; i++) {
    const v = next.variables[i];

    if (this.scope.type === 'global') {
      // TODO(indutny): const/let can be declared only once
    } else if (v.stack) {
      if (v.defs[0].kind === 'var') {
        if (!undef)
          undef = this.pipeline.add('literal').addLiteral('undefined');

        this.pipeline.add('ssa:store', undef).addLiteral(v.name);
      } else {
        // TODO(indutny): different holes for const/let ?
        if (!hole)
          hole = this.pipeline.add('oddball').addLiteral('hole');

        this.pipeline.add('ssa:store', hole).addLiteral(this.rename(v));
      }
    } else {
      throw new Error('No context variables so far');
    }
  }
};

Constructor.prototype.rename = function rename(v) {
  if (this.renamer.has(v))
    return `${this.renamer.get(v)}/${v.name}`;

  let prefix = this.renamer.size;
  this.renamer.set(v, prefix);
  return `${prefix}/${v.name}`;
};

Constructor.prototype.toSlot = function toSlot(ast) {
  let current = ast;
  if (current.type === 'MemberExpression') {
    const obj = this.visit(current.object);

    if (!current.computed)
      return Slot.createNamedProperty(obj, current.property.name);

    return Slot.createProperty(obj, this.visit(current.property));
  }

  assert.equal(current.type, 'Identifier');

  const ref = this.scope.resolve(current);
  assert(ref, 'Unknown internal reference');
  return Slot.createVar(ref);
};
