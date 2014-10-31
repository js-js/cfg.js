var tarjan = require('tarjan').create({
  successors: 'successorIds'
});

function Graph(cfg, options) {
  this.cfg = cfg;
  this.options = options || {};

  this.block = {
    list: [],
    map: {}
  };
  this.value = {
    list: [],
    map: {}
  };
}
module.exports = Graph;

Graph.prototype.construct = function construct() {
  // First pass: put everything into map
  for (var i = 0; i < this.cfg.length; i++) {
    var block = this.cfg[i];
    var b = new Block(block.id);
    this.block.map[b.id] = b;
    this.block.list.push(b);

    for (var j = 0; j < block.instructions.length; j++) {
      var instr = block.instructions[j];
      var val = b.createValue(instr.type, instr.id);
      this.value.list.push(val);

      val.assign = instr.assign;
      val.assignName = instr.assignName;
      this.value.map[val.id] = val;
    }
  }

  // Second pass: connect everything
  for (var i = 0, k = 0; i < this.cfg.length; i++) {
    var block = this.cfg[i];
    var b = this.block.map[block.id];

    // Connect blocks
    block.successors.forEach(function(succ) {
      b.addSuccessor(this.block.map[succ]);
    }, this);

    // Connect instructions
    for (var j = 0; j < block.instructions.length; j++) {
      var instr = block.instructions[j];
      var val = this.value.list[k++];
      b.instructions.push(val);

      instr.inputs.forEach(function(input) {
        if (input.type === 'instruction')
          val.addInput(this.value.map[input.id]);
        else if (input.type === 'js')
          val.addInput(b.createValue(input.type, input.value));
        else
          val.addInput(b.createValue(input.type, input.id));
      }, this);
    }
  }

  var out = this.cfg.map(function(block) {
    return this.block.map[block.id];
  }, this);

  // Find dominance fronteer
  if (this.options.frontier) {
    tarjan(out);

    out.forEach(function(block) {
      block.frontier = block.frontier.map(function(id) {
        return this.block.map[id];
      }, this);
      block.children = block.children.map(function(id) {
        return this.block.map[id];
      }, this);
    }, this);
  }

  return out;
};

Graph.strip = function strip(blocks) {
  return blocks.map(function(block) {
    return block.toJSON();
  });
};

function Block(id) {
  this.id = id;
  this.instructions = [];
  this.predecessors = [];
  this.successors = [];
  this.successorIds = [];

  // Dominator tree data
  this.parent = null;
  this.children = null;
  this.frontier = null;
}
Graph.Block = Block;

Block.prototype.addPredecessor = function addPredecessor(block) {
  this.predecessors.push(block);
};

Block.prototype.addSuccessor = function addSuccesor(block) {
  this.successors.push(block);
  this.successorIds.push(block.id);
  block.addPredecessor(this);
};

Block.prototype.dominates = function dominates(block) {
  if (i === this)
    return true;

  // Go up in the tree
  for (var i = block; i.parent !== null; i = i.parent)
    if (i.parent === this)
      return true;

  return false;
};

Block.prototype.createValue = function createValue(type, id) {
  return new Value(this, type, id);
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

function Value(block, type, id) {
  this.block = block;
  this.type = type;
  this.id = id;
  this.assign = false;
  this.assignName = null;

  this.inputs = [];
  this.uses = [];
}
Graph.Value = Value;

Value.prototype.addUse = function addUse(value) {
  this.uses.push(value);
};

Value.prototype.removeUse = function removeUse(value) {
  var index = this.uses.indexOf(value);
  if (index === -1)
    return;
  this.uses.splice(index, 1);
};

Value.prototype.addInput = function addInput(value) {
  this.inputs.push(value);
  value.addUse(this);
};

Value.prototype.dominates = function dominates(value) {
  if (value.type !== 'instruction')
    return true;

  return this.block.dominates(value.block);
};

Value.prototype.toJSON = function toJSON(short) {
  if (short) {
    if (this.type === 'js')
      return { type: 'js', value: this.id };
    else
      return { type: this.type, id: this.id };
  }

  return {
    id: this.id,
    type: this.type,
    inputs: this.inputs.map(function(input) {
      return input.toJSON(true);
    })
  };
};
