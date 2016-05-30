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
  else if (ast.type === 'UnaryExpression')
    return this.visitUnary(ast);
  else if (ast.type === 'BinaryExpression')
    return this.visitBinary(ast);
  else if (ast.type === 'UpdateExpression')
    return this.visitUpdate(ast);
  else if (ast.type === 'SequenceExpression')
    return this.visitSequence(ast);
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
  return this.load(this.toSlot(ast), ast);
};

Constructor.prototype.visitLiteral = function visitLiteral(ast) {
  let res;

  if ('regex' in ast) {
    res =
      this.pipeline.add('regexp')
      .addLiteral(ast.regex.pattern)
      .addLiteral(ast.regex.flags);
  } else {
    res = this.pipeline.add('literal').addLiteral(ast.value);
  }

  return this.bind(res, ast);
};

Constructor.prototype.visitAssignment = function visitAssignment(ast) {
  const slot = this.toSlot(ast.left);

  let right;

  if (ast.operator !== '=') {
    assert.equal(ast.operator[ast.operator.length - 1], '=');

    const initialValue = this.load(slot, ast.left);

    const arg = this.visit(ast.right);

    right =
      this.pipeline.add('binary')
      .addLiteral(ast.operator.slice(0, -1))
      .addInput(initialValue)
      .addInput(arg);
  } else {
    right = this.visit(ast.right);
  }

  return this.store(slot, right, ast);
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

Constructor.prototype.visitUnary = function visitUnary(ast) {
  const arg = this.visit(ast.argument);

  const res =
    this.pipeline.add('unary')
    .addLiteral(ast.operator)
    .addInput(arg);

  return this.bind(res, ast);
};

Constructor.prototype.visitBinary = function visitBinary(ast) {
  const left = this.visit(ast.left);
  const right = this.visit(ast.right);

  const res =
    this.pipeline.add('binary')
    .addLiteral(ast.operator)
    .addInput(left)
    .addInput(right);

  return this.bind(res, ast);
};

Constructor.prototype.visitUpdate = function visitUpdate(ast) {
  const slot = this.toSlot(ast.argument);

  const initialValue = this.load(slot, ast.argument);

  const diff = this.pipeline.add('literal').addLiteral(1);

  const updatedValue =
    this.pipeline.add('binary')
    .addLiteral(ast.operator === '++' ? '+' : '-')
    .addInput(initialValue)
    .addInput(diff);

  const res = this.store(slot, updatedValue, ast.argument);

  return ast.prefix ? res : initialValue;
};

Constructor.prototype.visitSequence = function visitSequence(ast) {
  let res;

  for (let i = 0; i < ast.expressions.length; i++) {
    res = this.visit(ast.expressions[i]);
  }

  return res;
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
  let obj, propAST;

  if (ast.type === 'MemberExpression') {
    obj = this.visit(ast.object);
    propAST = ast.property;

    if (ast.computed) {
      return Slot.createProperty(obj, this.visit(propAST));
    }
  } else {
    assert.equal(ast.type, 'Identifier');

    const ref = this.scope.resolve(ast);
    assert(ref, 'Unknown reference');

    if (ref.resolved !== null) {
      return Slot.createVar(ref);
    }

    obj = this.pipeline.add('global');
    propAST = ref.identifier;
  }

  const prop = this.pipeline.add('literal').addLiteral(propAST.name);

  return Slot.createProperty(obj, this.bind(prop, propAST));
};

Constructor.prototype.bind = function bind(node, ast) {
  if (!node)
    return node;

  node.data = ast;
  return node;
};

Constructor.prototype.load = function load(slot, ast) {
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
  } else {
    assert.equal(slot.kind, 'property');

    res = this.pipeline.add('storeProperty', [ slot.object, slot.property ]);
  }

  res.addInput(right);

  this.bind(res, ast);

  return right;
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
