exports.Graph = require('./ssa/graph');
exports.Constructor = require('./ssa/constructor');
exports.Deconstructor = require('./ssa/deconstructor');

// API

exports.construct = function construct(ast, options) {
  return new exports.Constructor(ast, options).construct();
};

exports.deconstruct = function deconstruct(ssa, options) {
  return new exports.Deconstructor(ssa, options).deconstruct();
};
