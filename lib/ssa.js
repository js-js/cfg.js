var assert = require('assert');

function SSA(ast, parent) {
  this.blockId = 0;
  this.valueId = 0;
  this.root = this.parent || this;

  this.ast = ast;
  this.scope = {};
  this.blocks = [];
  this.block = this.createBlock();
  this.contextSize = 0;
  this.parent = parent || null;
  this.loop = null;
}
module.exports = SSA;

SSA.construct = function construct(ast, parent) {
  return new SSA(ast, parent).construct();
};

SSA.prototype.construct = function construct() {
  var ast = this.ast;

  // Resolve local variables
  this.buildScope(ast);

  // Initialize local variables
  this.initializeLocals();

  // Build CFG
  this.visit(ast);

  return this.blocks.map(function(block) {
    return block.toJSON();
  });
};

SSA.prototype.buildScope = function buildScope(node) {
  var isFn = node.type === 'FunctionDeclaration' ||
             node.type === 'FunctionExpression';
  if (isFn) {
    var name = node.id.name;
    this.scope[name] = new Slot();

    if (node === this.ast) {
      for (var i = 0; i < node.params.length; i++)
        this.scope[node.params[i].name] = new Slot();
    }
  } else if (node.type === 'VariableDeclaration') {
    for (var i = 0; i < node.declarations.length; i++)
      this.scope[node.declarations[i].id.name] = new Slot();
  }

  // Visit direct children
  if ((node === this.ast || !isFn) && node.body) {
    if (Array.isArray(node.body)) {
      for (var i = 0; i < node.body.length; i++)
        this.buildScope(node.body[i]);
    } else {
      this.buildScope(node.body);
    }
  }

  if (node.type === 'ForStatement')
    this.buildScope(node.init);
};

SSA.prototype.initializeLocals = function initializeLocals() {
  Object.keys(this.scope).forEach(function(name) {
    this.set(name, this.visit({ type: 'Literal', value: undefined }));
  }, this);
};

SSA.prototype.lookup = function lookup(name, context) {
  if (this.scope.hasOwnProperty(name)) {
    var res = this.scope[name];

    if (!context || res.type !== 'local')
      return res;

    // Local => context
    res.type = 'context';
    res.index = this.contextSize++;
    res.depth = 0;
    return res;
  } else {
    var res;

    // Lookup in parent
    if (this.parent) {
      res = new Slot(this.parent.lookup(name, true));
    // Global variable
    } else {
      res = new Slot();
      res.type = 'global';
      res.key = name;
    }
    this.scope[name] = res;
    return res;
  }
};

// Visitors

SSA.prototype.visit = function visit(node) {
  // Top-level node, visit direct children
  if (node === this.ast) {
    for (var i = 0; i < node.body.length; i++)
      this.visit(node.body[i]);
    return;
  }

  var res;
  if (node.type === 'ExpressionStatement')
    res = this.visit(node.expression);
  else if (node.type === 'VariableDeclaration')
    res = this.visitVar(node);
  else if (node.type === 'Literal')
    res = this.visitLiteral(node);
  else if (node.type === 'Identifier')
    res = this.visitIdentifier(node);
  else if (node.type === 'AssignmentExpression')
    res = this.visitAssign(node);
  else if (node.type === 'BinaryExpression')
    res = this.visitBinary(node);
  else if (node.type === 'MemberExpression')
    res = this.visitMember(node);
  else if (node.type === 'LogicalExpression')
    res = this.visitLogic(node);
  else if (node.type === 'UpdateExpression')
    res = this.visitUpdate(node);
  else if (node.type === 'ReturnStatement')
    res = this.visitReturn(node);
  else if (node.type === 'IfStatement')
    res = this.visitIf(node);
  else if (node.type === 'WhileStatement')
    res = this.visitWhile(node);
  else if (node.type === 'ForStatement')
    res = this.visitFor(node);
  else if (node.type === 'BreakStatement')
    res = this.visitBreak(node);
  else if (node.type === 'ContinueStatement')
    res = this.visitContinue(node);
  else if (node.type === 'BlockStatement')
    res = this.visitBlock(node);
  else
    throw new Error('Unknown node type: ' + node.type);

  return res;
};

SSA.prototype.visitVar = function visitVar(node) {
  for (var i = 0; i < node.declarations.length; i++) {
    var decl = node.declarations[i];
    if (!decl.init)
      continue;

    var value = this.visit(decl.init);
    this.set(decl.id.name, value);
  }
};

SSA.prototype.visitLiteral = function visitLiteral(node) {
  return this.add('literal', [ this.createValue('js', node.value) ]);
};

SSA.prototype.visitIdentifier = function visitIdentifier(node) {
  return this.get(node.name);
};

SSA.prototype.visitAssign = function visitAssign(node) {
  if (node.operator !== '=') {
    return this.visit({
      type: 'AssignmentExpression',
      operator: '=',
      left: node.left,
      right: {
        type: 'BinaryExpression',
        operator: node.operator.slice(0, -1),
        left: node.left,
        right: node.right
      }
    });
  }

  var rhs = this.visit(node.right);

  // Just a variable
  if (node.left.type === 'Identifier')
    return this.set(node.left.name, rhs);

  // obj[prop] = rhs
  assert.equal(node.left.type, 'MemberExpression');
  var prop = node.left.computed ?
      this.visit(node.left.property) :
      this.createValue('js', node.left.property.name);
  var obj = this.visit(node.left.object);
  return this.add('storeProperty', [ obj, prop, rhs ]);
};

SSA.prototype.visitBinary = function visitBinary(node) {
  var lhs = this.visit(node.left);
  var rhs = this.visit(node.right);

  return this.add('binary', [
    this.createValue('js', node.operator),
    lhs,
    rhs
  ]);
};

SSA.prototype.visitMember = function visitMember(node) {
  var prop = node.computed ? this.visit(node.property) :
                             this.createValue('js', node.property.name);
  var obj = this.visit(node.object);

  return this.add('loadProperty', [ obj, prop ]);
};

SSA.prototype.visitLogic = function visitLogic(node) {
  var lhs = this.visit(node.left);
  var cons = this.createBlock();
  var alt = this.createBlock();
  var join = this.createBlock();
  var phi = this.createValue('instruction', 'phi', []);

  this.add('branch', [ lhs ]);
  if (node.operator === '||') {
    this.block.end(cons, alt);

    this.block = cons;
    this.add('to_phi', [ phi, lhs ]);
    this.block.end(join);

    this.block = alt;
  } else {
    this.block.end(cons, alt);

    this.block = alt;
    this.add('to_phi', [ phi, lhs ]);
    this.block.end(join);

    this.block = cons;
  }

  var rhs = this.visit(node.right);
  this.add('to_phi', [ phi, rhs ]);
  this.block.end(join);

  this.block = join;
  this.block.push(phi);

  return phi;
};

SSA.prototype.visitUpdate = function visitUpdate(node) {
  var one = { type: 'Literal', value: 1 };

  // ++v
  if (node.prefix) {
    return this.visit({
      type: 'AssignmentExpression',
      operator: '+=',
      left: node.argument,
      right: one
    });
  }

  var arg = this.visit(node.argument);
  var nop = this.add('nop', [ arg ]);
  var sum = this.add('binary', [
    this.createValue('js', '+'),
    nop,
    this.visit(one)
  ]);

  if (node.argument.type === 'Identifier') {
    // Just a variable
    this.set(arg.subtype, sum);
  } else {
    // obj[prop]++
    assert.equal(node.argument.type, 'MemberExpression');
    assert.equal(arg.type, 'instruction');
    assert.equal(arg.subtype, 'loadProperty');
    assert.equal(arg.inputs.length, 2);

    var obj = arg.inputs[0];
    var prop = arg.inputs[1];
    this.add('storeProperty', [ obj, prop, sum ]);
  }
  return nop;
};

SSA.prototype.visitReturn = function visitReturn(node) {
  return this.add('ret', [ this.visit(node.argument) ]);
};

SSA.prototype.visitIf = function visitIf(node) {
  var test = this.visit(node.test);
  var cons = this.createBlock();
  var alt = this.createBlock();
  var join = this.createBlock();

  this.add('branch', [ test ]);
  this.block.end(cons, alt);

  // Consequent
  this.block = cons;
  this.visit(node.consequent);
  this.block.end(join);

  // Alternate
  this.block = alt;
  if (node.alternate)
    this.visit(node.alternate);
  this.block.end(join);

  this.block = join;
};

SSA.prototype.visitWhile = function visitWhile(node) {
  this.enterLoop(function() {
    this.add('branch', [ this.visit(node.test) ]);
  }, function() {
    this.visit(node.body);
  });
};

SSA.prototype.visitFor = function visitFor(node) {
  this.visit(node.init);

  this.enterLoop(function() {
    this.add('branch', [ this.visit(node.test) ]);
  }, function() {
    this.visit(node.body);
  }, function() {
    this.visit(node.update);
  });
};

SSA.prototype.visitBreak = function visitBreak(node) {
  assert(this.loop, 'break without loop');
  this.block.end(this.loop.getBreak());
};

SSA.prototype.visitContinue = function visitContinue(node) {
  assert(this.loop, 'continue without loop');
  this.block.end(this.loop.getContinue());
};

SSA.prototype.visitBlock = function visitBlock(node) {
  for (var i = 0; i < node.body.length; i++)
    this.visit(node.body[i]);
};

// Helpers

SSA.prototype.createBlock = function createBlock() {
  var block = new Block(this.root);
  this.blocks.push(block);
  return block;
};

SSA.prototype.enterLoop = function enterLoop(test, content, update) {
  var oldLoop = this.loop;
  this.loop = new LoopInfo(this.root);

  var contStart = this.loop.cont;

  var prestart = this.createBlock();
  var start = this.createBlock();

  this.block.end(prestart);
  prestart.end(start);
  this.block = start;

  test.call(this);

  var body = this.createBlock();
  this.block.end(body, this.loop.brk);

  this.block = body;
  content.call(this);
  this.block.end(contStart);

  // Connect info to blocks
  this.block = this.loop.cont;
  if (update)
    update.call(this);
  this.block.end(prestart);

  this.block = this.loop.getBreak();
  this.loop = oldLoop;
};

SSA.prototype.createValue = function createValue(type, subtype, inputs) {
  return new Value(this.root, type, subtype, inputs);
};

SSA.prototype.add = function add(type, inputs) {
  var val = this.createValue('instruction', type, inputs);
  this.block.push(val);
  return val;
};

SSA.prototype.set = function set(name, value) {
  var slot = this.lookup(name);

  var res;
  if (slot.type === 'local') {
    value.markAssign(name);
    res = value;
  } else if (slot.type === 'global') {
    res = this.add('storeGlobal', [
      this.createValue('js', name),
      value
    ]);
  } else {
    res = this.add('storeContext', [
      this.createValue('js', slot.depth),
      this.createValue('js', slot.index),
      value
    ]);
  }

  return res;
};

SSA.prototype.get = function get(name) {
  var slot = this.lookup(name);

  var res;
  if (slot.type === 'local') {
    res = this.createValue('variable', name);
  } else if (slot.type === 'global') {
    res = this.add('loadGlobal', [ this.createValue('js', name) ]);
  } else {
    res = this.add('loadContext', [
      this.createValue('js', slot.depth),
      this.createValue('js', slot.index)
    ]);
  }

  return res;
};

// Various classes

function Block(ssa) {
  this.id = 'B' + ssa.blockId++;
  this.instructions = [];
  this.successors = [];
  this.ended = false;
}

Block.prototype.push = function push(instr) {
  if (!this.ended)
    this.instructions.push(instr);
};

Block.prototype.goto = function goto(block) {
  if (!this.ended)
    this.successors.push(block);
};

Block.prototype.end = function end(cons, alt) {
  if (cons)
    this.goto(cons);
  if (alt)
    this.goto(alt);
  this.ended = true;
};

Block.prototype.toJSON = function toJSON() {
  return {
    id: this.id,
    successors: this.successors.map(function(block) {
      return block.id;
    }),
    instructions: this.instructions.map(function(instr) {
      return instr.toJSON();
    })
  };
};

function Slot(parent) {
  if (parent) {
    this.type = parent.type;
    this.depth = this.type === 'context' ? parent.depth + 1 : parent.depth;
    this.index = parent.index;
  } else {
    this.type = 'local';
    this.depth = 0;
    this.index = 0;
  }

  // Only for global slots
  this.key = null;
}

function Value(ssa, type, subtype, inputs) {
  this.type = type;
  this.id = 'i' + ssa.valueId++;
  this.subtype = subtype;
  this.inputs = inputs ? inputs.map(function(value) {
    return value;
  }) : null;
  this.assign = false;
  this.assignName = null;
}

Value.prototype.toInput = function toInput() {
  if (this.type === 'js') {
    return { type: 'js', value: this.subtype };
  } else if (this.type === 'instruction') {
    if (this.assign)
      return { type: 'variable', id: this.assignName };
    return { type: 'instruction', id: this.id };
  } else {
    return { type: 'variable', id: this.subtype };
  }
};

Value.prototype.toJSON = function toJSON() {
  assert.equal(this.type, 'instruction');
  return {
    id: this.assign ? this.assignName : this.id,
    type: this.subtype,
    inputs: this.inputs.map(function(input) {
      return input.toInput();
    }),
    assign: this.assign
  };
};

Value.prototype.markAssign = function markAssign(name) {
  this.assign = true;
  this.assignName = name;
};

function LoopInfo(ssa) {
  this.ssa = ssa;
  this.cont = ssa.createBlock();
  this.brk = ssa.createBlock();
}

LoopInfo.prototype.getContinue = function getContinue() {
  var c = this.ssa.createBlock();
  this.cont.end(c);
  this.cont = c;
  return c;
};

LoopInfo.prototype.getBreak = function getBreak() {
  var c = this.ssa.createBlock();
  this.brk.end(c);
  this.brk = c;
  return c;
};
