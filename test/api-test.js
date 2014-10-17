var assert = require('assert');
var esprima = require('esprima');
var ir = require('ssa-ir');
var ssa = require('../');

describe('SSA.js', function() {
  function strip(source) {
    var lines = source.split(/\r\n|\r|\n/g);

    var out = lines.map(function(line) {
      return line.replace(/^\s*/, '');
    }).filter(function(line) {
      return !!line;
    });

    return out.join('\n');
  }

  function equalLines(actual, expected) {
    if (actual === expected)
      return;

    var actualLines = actual.split('\n');
    var expectedLines = expected.split('\n');
    var width = 0;

    expectedLines.unshift('    expected:');
    actualLines.unshift('    actual:');
    var total = Math.max(actualLines.length, expectedLines.length);

    if (actualLines.length !== total) {
      for (var i = actualLines.length; i < total; i++)
        actualLines.push('');
    } else {
      for (var i = expectedLines.length; i < total; i++)
        expectedLines.push('');
    }

    for (var i = 0; i < total; i++) {
      width = Math.max(width, actualLines[i].length);
      width = Math.max(width, expectedLines[i].length);
    }

    var out = '';
    for (var i = 0; i < total; i++) {
      var left = expectedLines[i];
      var right = actualLines[i];

      if (left !== right)
        out += '\033[31m';
      else
        out += '\033[32m';

      out += left;
      for (var j = left.length; j < width; j++)
        out += ' ';

      out += '  |  ';
      out += right;

      out += '\033[0m';

      out += '\n';
    }

    throw new Error('SSA output mismatch:\n\n' + out + '\n' + actual);
  }

  function test(name, input, expected, options) {
    it('should ' + name, function() {
      var ast = esprima.parse(
          input.toString().replace(/^function.*{|}$/g, '')
      );

      if (options && options.global === false)
        ast.type = 'Brogram';

      var out = ssa.construct(ast);
      var str = out.map(function(cfg) {
        return ir.stringify(cfg.blocks);
      }).join('\n----\n');

      var exp = expected.toString().replace(/^function.*{\/\*|\*\/}$/g, '');
      equalLines(strip(str), strip(exp));
    });
  }

  test('linear flow', function() {
    var a = 1;
    a += 2;
    a;
  }, function() {/*
    block B0
      @a = literal %undefined # 0
      @a = literal %1 # 2
      i6 = literal %2 # 6
      @a = binary %"+", @a, i6 # 4
      i11 = literal %undefined # 0
      i12 = ret i11 # 0
  */}, {
    global: false
  });

  test('just if/else', function() {
    var a = 1;
    var b;
    if (a) {
      b = 1;
    } else {
      b = 2;
    }
    b;
  }, function() {/*
    block B0 -> B1, B2
      @a = literal %undefined # 0
      @b = literal %undefined # 0
      @a = literal %1 # 2
      i7 = branch @a # 4
    block B1 -> B3
      @b = literal %1 # 9
    block B2 -> B3
      @b = literal %2 # 13
    block B3
      i14 = literal %undefined # 0
      i15 = ret i14 # 0
  */}, {
    global: false
  });

  test('if/else with var', function() {
    var a = 1;
    if (a) {
      var b = 1;
    } else {
      var b = 2;
    }
    b;
  }, function() {/*
    block B0 -> B1, B2
      @a = literal %undefined # 0
      @b = literal %undefined # 0
      @a = literal %1 # 2
      i7 = branch @a # 3
    block B1 -> B3
      @b = literal %1 # 7
    block B2 -> B3
      @b = literal %2 # 10
    block B3
      i14 = literal %undefined # 0
      i15 = ret i14 # 0
  */}, {
    global: false
  });

  test('if/else with context var', function() {
    var a = 1;
    if (a) {
      var b = 1;
    } else {
      var b = 2;
    }
    function x() {
      return b;
    }
    x();
  }, function() {/*
    block B0 -> B2, B3
      @a = literal %undefined # 0
      @b = literal %undefined # 0
      @x = fn %"B1" # 1
      @a = literal %1 # 6
      i13 = branch @a # 7
    block B2 -> B4
      i15 = literal %1 # 11
      i18 = storeContext %0, %0, i15 # 10
    block B3 -> B4
      i20 = literal %2 # 14
      i23 = storeContext %0, %0, i20 # 13
    block B4
      i25 = global # 17
      i27 = call @x, i25, %0 # 17
      i29 = literal %undefined # 0
      i30 = ret i29 # 0
    ----
    block B1
      i6 = loadContext %1, %0 # 4
      i7 = ret i6 # 3
  */}, {
    global: false
  });

  test('just while', function() {
    var i = 0;
    while (i < 42)
      i += 1;
    i;
  }, function() {/*
    block B0 -> B3
      @i = literal %undefined # 0
      @i = literal %0 # 2
    block B1 -> B3
    block B2 -> B6
    block B3 -> B4
    block B4 -> B5, B2
      i6 = literal %42 # 6
      i8 = binary %"<", @i, i6 # 4
      i9 = branch i8 # 3
    block B5 -> B1
      i12 = literal %1 # 10
      @i = binary %"+", @i, i12 # 8
    block B6
      i17 = literal %undefined # 0
      i18 = ret i17 # 0
  */}, {
    global: false
  });

  test('just do while', function() {
    var i = 0;
    do
      i += 1;
    while (i < 42);
    i;
  }, function() {/*
    block B0 -> B3
      @i = literal %undefined # 0
      @i = literal %0 # 2
    block B1 -> B3
    block B2 -> B6
    block B3 -> B5
    block B4 -> B5, B2
      i6 = literal %42 # 6
      i8 = binary %"<", @i, i6 # 4
      i9 = branch i8 # 3
    block B5 -> B1
      i12 = literal %1 # 10
      @i = binary %"+", @i, i12 # 8
    block B6
      i17 = literal %undefined # 0
      i18 = ret i17 # 0
  */}, {
    global: false
  });

  test('nested while', function() {
    var i = 0;
    while (i < 42) {
      var j = 0;
      while (j < 42) {
        i += 1;
        j += 1;
      }
    }
    i;
  }, function() {/*
    block B0 -> B3
      @i = literal %undefined # 0
      @j = literal %undefined # 0
      @i = literal %0 # 2
    block B1 -> B3
    block B2 -> B12
    block B3 -> B4
    block B4 -> B5, B2
      i8 = literal %42 # 6
      i10 = binary %"<", @i, i8 # 4
      i11 = branch i10 # 3
    block B5 -> B8
      @j = literal %0 # 9
    block B6 -> B8
    block B7 -> B11
    block B8 -> B9
    block B9 -> B10, B7
      i16 = literal %42 # 13
      i18 = binary %"<", @j, i16 # 11
      i19 = branch i18 # 10
    block B10 -> B6
      i22 = literal %1 # 18
      @i = binary %"+", @i, i22 # 16
      i27 = literal %1 # 22
      @j = binary %"+", @j, i27 # 20
    block B11 -> B1
    block B12
      i32 = literal %undefined # 0
      i33 = ret i32 # 0
  */}, {
    global: false
  });

  test('while with break/continue', function() {
    var i = 0;
    while (i < 42) {
      i += 1;
      if (i < 21)
        continue;
      if (i > 40)
        break;
    }
    i;
  }, function() {/*
    block B0 -> B3
      @i = literal %undefined # 0
      @i = literal %0 # 2
    block B1 -> B9
    block B2 -> B13
    block B3 -> B4
    block B4 -> B5, B2
      i6 = literal %42 # 6
      i8 = binary %"<", @i, i6 # 4
      i9 = branch i8 # 3
    block B5 -> B6, B7
      i12 = literal %1 # 11
      @i = binary %"+", @i, i12 # 9
      i17 = literal %21 # 15
      i19 = binary %"<", @i, i17 # 13
      i20 = branch i19 # 12
    block B6 -> B9
    block B7 -> B8
    block B8 -> B10, B11
      i23 = literal %40 # 20
      i25 = binary %">", @i, i23 # 18
      i26 = branch i25 # 17
    block B9 -> B3
    block B10 -> B13
    block B11 -> B12
    block B12 -> B1
    block B13 -> B14
    block B14
      i29 = literal %undefined # 0
      i30 = ret i29 # 0
  */}, {
    global: false
  });

  test('just for', function() {
    var j = 1;
    for (var i = 0; i < 42; i += 1) {
      j = j * 2;
    }
    j;
  }, function() {/*
    block B0 -> B3
      @j = literal %undefined # 0
      @i = literal %undefined # 0
      @j = literal %1 # 2
      @i = literal %0 # 5
    block B1 -> B3
      i21 = literal %1 # 17
      @i = binary %"+", @i, i21 # 15
    block B2 -> B6
    block B3 -> B4
    block B4 -> B5, B2
      i10 = literal %42 # 8
      i12 = binary %"<", @i, i10 # 6
      i13 = branch i12 # 3
    block B5 -> B1
      i16 = literal %2 # 14
      @j = binary %"*", @j, i16 # 12
    block B6
      i26 = literal %undefined # 0
      i27 = ret i26 # 0
  */}, {
    global: false
  });

  test('empty for', function() {
    for (;;);
  }, function() {/*
    block B0 -> B3
    block B1 -> B3
    block B2 -> B6
    block B3 -> B4
    block B4 -> B5, B2
      i1 = literal %true # 1
      i2 = branch i1 # 1
    block B5 -> B1
    block B6
      i4 = literal %undefined # 0
      i5 = ret i4 # 0
  */});

  test('just member assign', function() {
    a.b = 1;
  }, function() {/*
    block B0
      i1 = literal %1 # 3
      i3 = literal %"b" # 2
      i5 = loadGlobal %"a" # 4
      i6 = storeProperty i5, i3, i1 # 2
      i7 = ret i1 # 3
  */});

  test('just double member assign', function() {
    a.b.c = 1;
  }, function() {/*
    block B0
      i1 = literal %1 # 3
      i3 = literal %"c" # 2
      i5 = literal %"b" # 4
      i7 = loadGlobal %"a" # 5
      i8 = loadProperty i7, i5 # 4
      i9 = storeProperty i8, i3, i1 # 2
      i10 = ret i1 # 3
  */});

  test('just computed member assign', function() {
    a[b] = 1;
  }, function() {/*
    block B0
      i1 = literal %1 # 3
      i3 = loadGlobal %"b" # 4
      i5 = loadGlobal %"a" # 5
      i6 = storeProperty i5, i3, i1 # 2
      i7 = ret i1 # 3
  */});

  test('just logical expression', function() {
    a || b && c;
  }, function() {/*
    block B0 -> B1, B2
      i1 = loadGlobal %"a" # 3
      i3 = branch i1 # 2
    block B1 -> B3
      i4 = to_phi i2, i1 # 2
    block B2 -> B4, B5
      i6 = loadGlobal %"b" # 5
      i8 = branch i6 # 4
    block B3
      i2 = phi # 2
      i14 = ret i2 # 2
    block B4 -> B6
      i11 = loadGlobal %"c" # 6
      i12 = to_phi i7, i11 # 4
    block B5 -> B6
      i9 = to_phi i7, i6 # 4
    block B6 -> B3
      i7 = phi # 4
      i13 = to_phi i2, i7 # 2
  */});

  test('just postfix update expression', function() {
    var i = 0;
    i++;
  }, function() {/*
    block B0
      @i = literal %undefined # 0
      @i = literal %0 # 2
      i5 = nop @i # 4
      i8 = literal %1 # 4
      @i = binary %"+", i5, i8 # 4
      i11 = literal %undefined # 0
      i12 = ret i11 # 0
  */}, {
    global: false
  });

  test('just prefix update expression', function() {
    var i = 0;
    ++i;
  }, function() {/*
    block B0
      @i = literal %undefined # 0
      @i = literal %0 # 2
      i6 = literal %1 # 4
      @i = binary %"+", @i, i6 # 4
      i10 = literal %undefined # 0
      i11 = ret i10 # 0
  */}, {
    global: false
  });

  test('member postfix update expression', function() {
    a.b++;
  }, function() {/*
    block B0
      i1 = literal %"b" # 3
      i3 = loadGlobal %"a" # 4
      i4 = loadProperty i3, i1 # 3
      i5 = nop i4 # 2
      i8 = literal %1 # 2
      i9 = binary %"+", i5, i8 # 2
      i10 = storeProperty i3, i1, i9 # 2
      i11 = ret i5 # 2
  */});

  test('member prefix update expression', function() {
    ++a.b;
  }, function() {/*
    block B0
      i1 = literal %"b" # 3
      i3 = loadGlobal %"a" # 4
      i4 = loadProperty i3, i1 # 3
      i6 = literal %1 # 2
      i8 = binary %"+", i4, i6 # 2
      i9 = storeProperty i3, i1, i8 # 2
      i10 = ret i8 # 2
  */});

  test('just new expression', function() {
    new Proto(1, 2, 3);
  }, function() {/*
    block B0
      i1 = loadGlobal %"Proto" # 3
      i3 = literal %1 # 4
      i5 = literal %2 # 5
      i7 = literal %3 # 6
      i8 = pushArg i7 # 2
      i9 = pushArg i5 # 2
      i10 = pushArg i3 # 2
      i12 = new i1, %3 # 2
      i13 = ret i12 # 2
  */});

  test('just call expression', function() {
    fn(1, 2, 3);
  }, function() {/*
    block B0
      i1 = loadGlobal %"fn" # 3
      i3 = literal %1 # 4
      i5 = literal %2 # 5
      i7 = literal %3 # 6
      i8 = pushArg i7 # 2
      i9 = pushArg i5 # 2
      i10 = pushArg i3 # 2
      i11 = global # 2
      i13 = call i1, i11, %3 # 2
      i14 = ret i13 # 2
  */});

  test('just unary operation', function() {
    var i = 0;
    -i;
  }, function() {/*
    block B0
      @i = literal %undefined # 0
      @i = literal %0 # 2
      i6 = unary %"-", @i # 4
      i8 = literal %undefined # 0
      i9 = ret i8 # 0
  */}, {
    global: false
  });

  test('global delete', function() {
    delete a;
  }, function() {/*
    block B0
      i1 = deleteGlobal %"a" # 2
      i2 = ret i1 # 2
  */});

  test('member delete', function() {
    var a;
    delete a.b;
  }, function() {/*
    block B0
      @a = literal %undefined # 0
      i3 = literal %"b" # 3
      i5 = deleteProperty @a, i3 # 3
      i7 = literal %undefined # 0
      i8 = ret i7 # 0
  */}, {
    global: false
  });

  test('just sequence', function() {
    (a, b, c);
  }, function() {/*
    block B0
      i1 = loadGlobal %"a" # 3
      i3 = loadGlobal %"b" # 4
      i5 = loadGlobal %"c" # 5
      i6 = ret i5 # 5
  */});

  test('just array', function() {
    [1, 2, 3];
  }, function() {/*
    block B0
      i1 = array %3 # 2
      i3 = literal %1 # 3
      i5 = literal %0 # 2
      i6 = storeProperty i1, i5, i3 # 2
      i8 = literal %2 # 4
      i10 = literal %1 # 2
      i11 = storeProperty i1, i10, i8 # 2
      i13 = literal %3 # 5
      i15 = literal %2 # 2
      i16 = storeProperty i1, i15, i13 # 2
      i17 = ret i1 # 2
  */});

  test('just object', function() {
    ({ a: 1, 2: x });
  }, function() {/*
    block B0
      i1 = object %2 # 2
      i3 = literal %"a" # 2
      i5 = literal %1 # 3
      i6 = storeProperty i1, i3, i5 # 2
      i8 = literal %2 # 2
      i10 = loadGlobal %"x" # 4
      i11 = storeProperty i1, i8, i10 # 2
      i12 = ret i1 # 2
  */});

  test('empty block', function() {
  }, function() {/*
    block B0
      i1 = literal %undefined # 0
      i2 = ret i1 # 0
  */});

  test('just a conditional expression', function() {
    a ? b : c;
  }, function() {/*
    block B0 -> B1, B2
      i1 = loadGlobal %"a" # 3
      i3 = branch i1 # 2
    block B1 -> B3
      i5 = loadGlobal %"b" # 4
      i6 = to_phi i2, i5 # 2
    block B2 -> B3
      i8 = loadGlobal %"c" # 5
      i9 = to_phi i2, i8 # 2
    block B3
      i2 = phi # 2
      i10 = ret i2 # 2
  */});

  test('just a function declaration', function() {
    function a(b, c, d) {
      if (a(0, 0, 0) < 0)
        return 0 - b - c - d;
      return b + c + d;
    }
    a(1, 2, 3);
  }, function() {/*
    block B0
      i45 = fn %"B1" # 1
      i47 = storeGlobal %"a", i45 # 0
      i49 = loadGlobal %"a" # 28
      i51 = literal %1 # 29
      i53 = literal %2 # 30
      i55 = literal %3 # 31
      i56 = pushArg i55 # 27
      i57 = pushArg i53 # 27
      i58 = pushArg i51 # 27
      i59 = global # 27
      i61 = call i49, i59, %3 # 27
      i62 = ret i61 # 27
    ----
    block B1 -> B2, B3
      @b = loadArg %0 # 1
      @c = loadArg %1 # 1
      @d = loadArg %2 # 1
      i6 = self # 6
      i8 = literal %0 # 7
      i10 = literal %0 # 8
      i12 = literal %0 # 9
      i13 = pushArg i12 # 5
      i14 = pushArg i10 # 5
      i15 = pushArg i8 # 5
      i16 = global # 5
      i18 = call i6, i16, %3 # 5
      i20 = literal %0 # 10
      i22 = binary %"<", i18, i20 # 4
      i23 = branch i22 # 3
    block B2
      i25 = literal %0 # 15
      i28 = binary %"-", i25, @b # 14
      i31 = binary %"-", i28, @c # 13
      i34 = binary %"-", i31, @d # 12
      i35 = ret i34 # 11
    block B3 -> B4
    block B4
      i39 = binary %"+", @b, @c # 21
      i42 = binary %"+", i39, @d # 20
      i43 = ret i42 # 19
  */});

  test('just a this expression', function() {
    this.a;
  }, function() {/*
    block B0
      i1 = literal %"a" # 2
      i2 = this # 3
      i3 = loadProperty i2, i1 # 2
      i4 = ret i3 # 2
  */});

  test('call with context', function() {
    a.b();
  }, function() {/*
    block B0
      i1 = literal %"b" # 3
      i3 = loadGlobal %"a" # 4
      i4 = loadProperty i3, i1 # 3
      i6 = call i4, i3, %0 # 2
      i7 = ret i6 # 2
  */});

  test('function with no return', function() {
    function test(a) {
      a;
    }
  }, function() {/*
    block B0
      i7 = fn %"B1" # 1
      i9 = storeGlobal %"test", i7 # 0
      i11 = literal %undefined # 0
      i12 = ret i11 # 0
    ----
    block B1
      @a = loadArg %0 # 1
      i4 = literal %undefined # 1
      i5 = ret i4 # 1
  */});

  test('function boundary regression', function() {
    function run() {
      var x = 1;
      for (var i = 0; i < 10; i++)
        x += i;
      return x;
    }
    run();
  }, function() {/*
  block B0
    i27 = fn %"B1" # 1
    i29 = storeGlobal %"run", i27 # 0
    i31 = loadGlobal %"run" # 22
    i32 = global # 21
    i34 = call i31, i32, %0 # 21
    i35 = ret i34 # 21
  ----
  block B1 -> B4
    @x = literal %undefined # 1
    @i = literal %undefined # 1
    @x = literal %1 # 4
    @i = literal %0 # 7
  block B2 -> B4
    i19 = nop @i # 15
    i22 = literal %1 # 15
    @i = binary %"+", i19, i22 # 15
  block B3 -> B7
  block B4 -> B5
  block B5 -> B6, B3
    i10 = literal %10 # 10
    i12 = binary %"<", @i, i10 # 8
    i13 = branch i12 # 5
  block B6 -> B2
    @x = binary %"+", @x, @i # 12
  block B7
    i25 = ret @x # 17
  */});
});
