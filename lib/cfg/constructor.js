'use strict';

const assert = require('assert');
const pipeline = require('json-pipeline');

const cfg = require('../cfg');
const Scope = cfg.Scope;
const Slot = cfg.Slot;

function Constructor(options) {
  this.options = options || {};
  this.scope = null;
  this.ast = null;
  this.pipeline = null;
  this.result = null;
}
module.exports = Constructor;

Constructor.prototype.build = function build(ast) {
  this.ast = ast;
  // Global scope
  this.scope = new Scope('global', null);
  this.pipeline = null;

  const res = [];
  this.result = res;

  this.visit(ast);

  this.result = null;
  this.pipeline = null;
  this.scope = null;
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

  this.scope = this.scope.enter('program');
  this.visitList(ast.body);
  this.scope = this.scope.leave();

  return null;
};

Constructor.prototype.visitStmt = function visitStmt(ast) {
  this.visit(ast.expression);

  return null;
};

Constructor.prototype.visitIdentifier = function visitIdentifier(ast) {
  const res = this.scope.load(this.pipeline, ast.name);
  this.bind(res, ast);
  return res;
};

Constructor.prototype.visitLiteral = function visitLiteral(ast) {
  return this.bind(this.pipeline.add('literal').addLiteral(ast.value), ast);
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
  return Slot.createVar(current.name);
};

Constructor.prototype.visitAssignment = function visitAssignment(ast) {
  if (ast.operator === '=') {
    const slot = this.toSlot(ast.left);
    const right = this.visit(ast.right);

    let res;
    if (slot.kind === 'var') {
      res = this.scope.store(this.pipeline, slot.name, right);
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
  assert.equal(ast.kind, 'var', 'let,const is not supported yet');

  for (let i = 0; i < ast.declarations.length; i++) {
    const decl = ast.declarations[i];

    assert.equal(decl.id.type, 'Identifier');
    this.scope.declare(ast.kind, decl.id.name);

    const value = decl.init === null ?
        { type: 'Identifier', name: 'undefined' } : decl.init;

    this.visit({
      loc: decl.loc,
      type: 'AssignmentExpression',
      operator: '=',
      left: decl.id,
      right: value
    });
  }
};
