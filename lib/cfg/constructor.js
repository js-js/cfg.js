'use strict';

const assert = require('assert');
const escope = require('escope');
const pipeline = require('json-pipeline');

const cfg = require('../cfg');
const Slot = cfg.Slot;

const CONTEXT_SLOT_SELF = -1;

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

Constructor.CONTEXT_SLOT_SLEF = CONTEXT_SLOT_SELF;

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

//
// Visitors
//

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
  else if (ast.type === 'Identifier' || ast.type === 'MemberExpression')
    return this.visitReference(ast);
  else if (ast.type === 'Literal')
    return this.visitLiteral(ast);
  else if (ast.type === 'AssignmentExpression')
    return this.visitAssignment(ast);
  else if (ast.type === 'VariableDeclaration')
    return this.visitVarDecl(ast);
  else if (ast.type === 'FunctionDeclaration')
    return this.visitFnDecl(ast);
  else if (ast.type === 'FunctionExpression')
    return this.visitFnExpr(ast);
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

Constructor.prototype.visitReference = function visitReference(ast) {
  const slot = this.toSlot(ast);

  let res;
  if (slot.kind === 'var') {
    const ref = slot.ref;

    if (ref.resolved.stack) {
      res = this.pipeline.add('ssa:load').addLiteral(this.rename(ref.resolved));
    } else if (ref.resolved.scope.type === 'function-expression-name') {
      let depth = -1;
      for (let s = this.scope; s !== ref.resolved.scope; s = s.upper) {
        if (s.type === 'function')
          depth++;
      }

      res = this.pipeline.add('loadContext').addLiteral(depth);
      res.addLiteral(CONTEXT_SLOT_SELF);
    } else {
      throw new Error('Context loads not implemented yet');
    }
  } else {
    assert.equal(slot.kind, 'property');

    res = this.pipeline.add('loadProperty', [ slot.object, slot.property ]);
  }

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

    return this.store(slot, right, ast);
  }

  throw new Error('Not implemented');
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

Constructor.prototype.visitFnDecl = function visitFnDecl(ast) {
  // No-op, see `declareFn`
};

Constructor.prototype.visitFnExpr = function visitFnExpr(ast) {
  return this.declareFn(ast);
};

//
// Routines
//

Constructor.prototype.enter = function enter(ast) {
  const next = this.scopes.acquire(ast);
  if (!next)
    return;

  this.scope = next;

  let undef;
  let global;
  let hole;

  // Initialize all scope variables
  for (let i = 0; i < next.variables.length; i++) {
    const v = next.variables[i];

    if (v.scope.type === 'function-expression-name') {
      // Nothing to do, it is in the context
    } else if (v.scope.type === 'global') {
      const def = v.defs[0];

      if (def.type !== 'FunctionName')
        continue;

      if (!global)
        global = this.pipeline.add('global');

      const node = def.node;
      const name = this.bind(
        this.pipeline.add('literal').addLiteral(node.id.name),
        node.id
      );
      const slot = Slot.createProperty(global, name);
      this.store(slot, this.declareFn(node), node);
      // TODO(indutny): const/let can be declared only once
    } else {
      let value;

      if (v.scope.type === 'function') {
        if (v.name !== 'arguments' || v.defs.length !== 0)
          continue;

        if (!v.scope.isArgumentsMaterialized())
          continue;

        value = this.pipeline.add('arguments');
      } else if (v.stack) {
        if (v.defs[0].kind === 'var') {
          if (!undef)
            undef = this.pipeline.add('literal').addLiteral('undefined');

          value = undef;
        } else {
          // TODO(indutny): different holes for const/let ?
          if (!hole)
            hole = this.pipeline.add('oddball').addLiteral('hole');

          value = hole;
        }
      } else {
        throw new Error('No context variables so far');
      }

      this.pipeline.add('ssa:store', value).addLiteral(this.rename(v));
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
    const propAST = current.property;
    let prop;

    if (current.computed) {
      prop = this.visit(propAST);
    } else {
      prop = this.bind(
        this.pipeline.add('literal').addLiteral(propAST.name),
        propAST
      );
    }

    return Slot.createProperty(obj, prop);
  }

  assert.equal(current.type, 'Identifier');

  const ref = this.scope.resolve(current);

  assert(ref, 'Unknown reference');

  if (ref.resolved === null) {
    const obj = this.pipeline.add('global');
    const prop = this.bind(
      this.pipeline.add('literal').addLiteral(ref.identifier.name),
      ref.identifier
    );

    return Slot.createProperty(obj, prop);
  }

  return Slot.createVar(ref);
};

Constructor.prototype.bind = function bind(node, ast) {
  if (!node)
    return node;

  node.data = ast;
  return node;
};

Constructor.prototype.store = function store(slot, right, ast) {
  let res;
  if (slot.kind === 'var') {
    const ref = slot.ref;

    if (ref.resolved.stack) {
      res = this.pipeline.add('ssa:store')
          .addLiteral(this.rename(ref.resolved));
    } else {
      throw new Error('Context loads not implemented yet');
    }

    res.addInput(right);
  } else {
    assert.equal(slot.kind, 'property');

    res = this.pipeline.add('storeProperty', [
        slot.object, slot.property, right ]);
  }

  this.bind(res, ast);

  return res;
};

Constructor.prototype.declareFn = function declareFn(ast) {
  const p = pipeline.create('cfg');
  const old = this.pipeline;

  const id = this.result.length;

  this.pipeline = p;
  this.result.push(p);
  this.bind(p.block(), ast);

  const oldScope = this.scope;

  this.enter(ast);
  this.enter(ast.body);

  if (this.scope.type === 'function-expression-name')
    this.scope = this.scope.childScopes[0];

  this.visit(ast.body);

  this.scope = oldScope;
  this.pipeline = old;

  return this.bind(this.pipeline.add('fn').addLiteral(id), ast);
};
