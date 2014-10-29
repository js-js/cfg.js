exports.Graph = require('./cfg/graph');
exports.Constructor = require('./cfg/constructor');
exports.Deconstructor = require('./cfg/deconstructor');

// API

exports.construct = function construct(ast, options) {
  return new exports.Constructor(ast, options).construct();
};

exports.deconstruct = function deconstruct(cfg, options) {
  return new exports.Deconstructor(cfg, options).deconstruct();
};
