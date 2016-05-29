'use strict';

function Slot(kind) {
  this.kind = kind;
  this.object = null;
  this.property = null;
  this.name = null;
  this.ref = null;
}
module.exports = Slot;

Slot.createVar = function createVar(ref) {
  const res = new Slot('var');
  res.ref = ref;
  return res;
};

Slot.createProperty = function createProperty(object, property) {
  const res = new Slot('property');
  res.object = object;
  res.property = property;
  return res;
};
