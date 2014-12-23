var assert = require('assert');
var esprima = require('esprima');
var ir = require('cfg-ir');
var cfg = require('../');

var fixtures = require('./fixtures');
var strip = fixtures.strip;
var equalLines = fixtures.equalLines;

describe('CFG.js', function() {
  function test(name, input, expected, options) {
    it('should ' + name, function() {
      var ast = esprima.parse(
          input.toString().replace(/^function.*{|}$/g, '')
      );

      if (options && options.global === false)
        ast.type = 'Brogram';

      var out = cfg.construct(ast);
      var str = out.map(function(cfg) {
        return ir.stringify(cfg);
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
      i4 = literal %2 # 6
      @a = binary %"+", @a, i4 # 4
      i9 = literal %undefined # 0
      i11 = ret i9 # 0
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
      i6 = branch @a # 4
    block B1 -> B3
      @b = literal %1 # 9
    block B2 -> B3
      @b = literal %2 # 13
    block B3
      i12 = literal %undefined # 0
      i14 = ret i12 # 0
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
    ret(b);
  }, function() {/*
    block B0 -> B1, B2
      @a = literal %undefined # 0
      @b = literal %undefined # 0
      @a = literal %1 # 2
      i6 = branch @a # 3
    block B1 -> B3
      @b = literal %1 # 7
    block B2 -> B3
      @b = literal %2 # 10
    block B3
      i12 = loadGlobal %"ret" # 13
      i14 = pushArg @b # 12
      i16 = global # 12
      i17 = call i12, i16, %1 # 12
      i19 = literal %undefined # 0
      i21 = ret i19 # 0
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
      i2 = literal %undefined # 0
      @x = fn %"B1" # 1
      i6 = storeContext %0, %0, i2 # 0
      @a = literal %1 # 6
      i11 = branch @a # 7
    block B2 -> B4
      i13 = literal %1 # 11
      i15 = storeContext %0, %0, i13 # 10
    block B3 -> B4
      i18 = literal %2 # 14
      i20 = storeContext %0, %0, i18 # 13
    block B4
      i23 = global # 17
      i24 = call @x, i23, %0 # 17
      i27 = literal %undefined # 0
      i29 = ret i27 # 0
    ----
    block B1
      i0 = loadContext %1, %0 # 4
      i3 = ret i0 # 3
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
      i4 = literal %42 # 6
      i6 = binary %"<", @i, i4 # 4
      i9 = branch i6 # 3
    block B5 -> B1
      i10 = literal %1 # 10
      @i = binary %"+", @i, i10 # 8
    block B6
      i15 = literal %undefined # 0
      i17 = ret i15 # 0
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
      i4 = literal %42 # 6
      i6 = binary %"<", @i, i4 # 4
      i9 = branch i6 # 3
    block B5 -> B1
      i10 = literal %1 # 10
      @i = binary %"+", @i, i10 # 8
    block B6
      i15 = literal %undefined # 0
      i17 = ret i15 # 0
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
      i6 = literal %42 # 6
      i8 = binary %"<", @i, i6 # 4
      i11 = branch i8 # 3
    block B5 -> B8
      @j = literal %0 # 9
    block B6 -> B8
    block B7 -> B11
    block B8 -> B9
    block B9 -> B10, B7
      i14 = literal %42 # 13
      i16 = binary %"<", @j, i14 # 11
      i19 = branch i16 # 10
    block B10 -> B6
      i20 = literal %1 # 18
      @i = binary %"+", @i, i20 # 16
      i25 = literal %1 # 22
      @j = binary %"+", @j, i25 # 20
    block B11 -> B1
    block B12
      i30 = literal %undefined # 0
      i32 = ret i30 # 0
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
      i4 = literal %42 # 6
      i6 = binary %"<", @i, i4 # 4
      i9 = branch i6 # 3
    block B5 -> B6, B7
      i10 = literal %1 # 11
      @i = binary %"+", @i, i10 # 9
      i15 = literal %21 # 15
      i17 = binary %"<", @i, i15 # 13
      i20 = branch i17 # 12
    block B6 -> B9
    block B7 -> B8
    block B8 -> B10, B11
      i21 = literal %40 # 20
      i23 = binary %">", @i, i21 # 18
      i26 = branch i23 # 17
    block B9 -> B3
    block B10 -> B13
    block B11 -> B12
    block B12 -> B1
    block B13 -> B14
    block B14
      i27 = literal %undefined # 0
      i29 = ret i27 # 0
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
      i8 = literal %1 # 17
      @i = binary %"+", @i, i8 # 15
    block B2 -> B6
    block B3 -> B4
    block B4 -> B5, B2
      i13 = literal %42 # 8
      i15 = binary %"<", @i, i13 # 6
      i18 = branch i15 # 3
    block B5 -> B1
      i19 = literal %2 # 14
      @j = binary %"*", @j, i19 # 12
    block B6
      i24 = literal %undefined # 0
      i26 = ret i24 # 0
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
      i0 = literal %true # 1
      i2 = branch i0 # 1
    block B5 -> B1
    block B6
      i3 = literal %undefined # 0
      i5 = ret i3 # 0
  */});

  test('just member assign', function() {
    a.b = 1;
  }, function() {/*
    block B0
      i0 = literal %1 # 3
      i2 = literal %"b" # 2
      i4 = loadGlobal %"a" # 4
      i6 = storeProperty i4, i2, i0 # 2
      i7 = ret i0 # 3
  */});

  test('just double member assign', function() {
    a.b.c = 1;
  }, function() {/*
    block B0
      i0 = literal %1 # 3
      i2 = literal %"c" # 2
      i4 = literal %"b" # 4
      i6 = loadGlobal %"a" # 5
      i8 = loadProperty i6, i4 # 4
      i9 = storeProperty i8, i2, i0 # 2
      i10 = ret i0 # 3
  */});

  test('just computed member assign', function() {
    a[b] = 1;
  }, function() {/*
    block B0
      i0 = literal %1 # 3
      i2 = loadGlobal %"b" # 4
      i4 = loadGlobal %"a" # 5
      i6 = storeProperty i4, i2, i0 # 2
      i7 = ret i0 # 3
  */});

  test('just logical expression', function() {
    a || b && c;
  }, function() {/*
    block B0 -> B1, B2
      i0 = loadGlobal %"a" # 3
      i2 = branch i0 # 2
    block B1 -> B3
      i3 = to_phi i4, i0 # 2
    block B2 -> B4, B5
      i5 = loadGlobal %"b" # 5
      i7 = branch i5 # 4
    block B3
      i4 = phi # 2
      i8 = ret i4 # 2
    block B4 -> B6
      i9 = loadGlobal %"c" # 6
      i11 = to_phi i12, i9 # 4
    block B5 -> B6
      i13 = to_phi i12, i5 # 4
    block B6 -> B3
      i12 = phi # 4
      i14 = to_phi i4, i12 # 2
  */});

  test('just postfix update expression', function() {
    var i = 0;
    i++;
  }, function() {/*
    block B0
      @i = literal %undefined # 0
      @i = literal %0 # 2
      i4 = nop @i # 4
      i6 = literal %1 # 4
      @i = binary %"+", i4, i6 # 4
      i10 = literal %undefined # 0
      i12 = ret i10 # 0
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
      i4 = literal %1 # 4
      @i = binary %"+", @i, i4 # 4
      i9 = literal %undefined # 0
      i11 = ret i9 # 0
  */}, {
    global: false
  });

  test('member postfix update expression', function() {
    a.b++;
  }, function() {/*
    block B0
      i0 = literal %"b" # 3
      i2 = loadGlobal %"a" # 4
      i4 = loadProperty i2, i0 # 3
      i5 = nop i4 # 2
      i6 = literal %1 # 2
      i8 = binary %"+", i5, i6 # 2
      i10 = storeProperty i2, i0, i8 # 2
      i11 = ret i5 # 2
  */});

  test('member prefix update expression', function() {
    ++a.b;
  }, function() {/*
    block B0
      i0 = literal %"b" # 3
      i2 = loadGlobal %"a" # 4
      i4 = loadProperty i2, i0 # 3
      i5 = literal %1 # 2
      i7 = binary %"+", i4, i5 # 2
      i9 = storeProperty i2, i0, i7 # 2
      i10 = ret i7 # 2
  */});

  test('just postfix global update expression', function() {
    i++;
  }, function() {/*
    block B0
      i0 = loadGlobal %"i" # 3
      i2 = nop i0 # 2
      i3 = literal %1 # 2
      i5 = binary %"+", i2, i3 # 2
      i7 = storeGlobal %"i", i5 # 2
      i9 = ret i2 # 2
  */});

  test('just postfix context update expression', function() {
    var i;
    function test() {
      i++;
    }
  }, function() {/*
    block B0
      i0 = literal %undefined # 0
      @test = fn %"B1" # 1
      i4 = storeContext %0, %0, i0 # 0
      i7 = literal %undefined # 0
      i9 = ret i7 # 0
    ----
    block B1
      i0 = loadContext %1, %0 # 5
      i3 = nop i0 # 4
      i4 = literal %1 # 4
      i6 = binary %"+", i3, i4 # 4
      i8 = storeContext %1, %0, i6 # 4
      i11 = literal %undefined # 1
      i13 = ret i11 # 1
  */}, {
    global: false
  });

  test('just new expression', function() {
    new Proto(1, 2, 3);
  }, function() {/*
    block B0
      i0 = loadGlobal %"Proto" # 3
      i2 = literal %1 # 4
      i4 = literal %2 # 5
      i6 = literal %3 # 6
      i8 = pushArg i6 # 2
      i9 = pushArg i4 # 2
      i10 = pushArg i2 # 2
      i11 = new i0, %3 # 2
      i13 = ret i11 # 2
  */});

  test('just call expression', function() {
    fn(1, 2, 3);
  }, function() {/*
    block B0
      i0 = loadGlobal %"fn" # 3
      i2 = literal %1 # 4
      i4 = literal %2 # 5
      i6 = literal %3 # 6
      i8 = pushArg i6 # 2
      i9 = pushArg i4 # 2
      i10 = pushArg i2 # 2
      i11 = global # 2
      i12 = call i0, i11, %3 # 2
      i14 = ret i12 # 2
  */});

  test('just unary operation', function() {
    var i = 0;
    -i;
  }, function() {/*
    block B0
      @i = literal %undefined # 0
      @i = literal %0 # 2
      i4 = unary %"-", @i # 4
      i7 = literal %undefined # 0
      i9 = ret i7 # 0
  */}, {
    global: false
  });

  test('global delete', function() {
    delete a;
  }, function() {/*
    block B0
      i0 = deleteGlobal %"a" # 2
      i2 = ret i0 # 2
  */});

  test('member delete', function() {
    var a;
    delete a.b;
  }, function() {/*
    block B0
      @a = literal %undefined # 0
      i2 = literal %"b" # 3
      i4 = deleteProperty @a, i2 # 3
      i6 = literal %undefined # 0
      i8 = ret i6 # 0
  */}, {
    global: false
  });

  test('just sequence', function() {
    (a, b, c);
  }, function() {/*
    block B0
      i0 = loadGlobal %"a" # 3
      i2 = loadGlobal %"b" # 4
      i4 = loadGlobal %"c" # 5
      i6 = ret i4 # 5
  */});

  test('just array', function() {
    [1, 2, 3];
  }, function() {/*
    block B0
      i0 = array %3 # 2
      i2 = literal %1 # 3
      i4 = literal %0 # 2
      i6 = storeProperty i0, i4, i2 # 2
      i7 = literal %2 # 4
      i9 = literal %1 # 2
      i11 = storeProperty i0, i9, i7 # 2
      i12 = literal %3 # 5
      i14 = literal %2 # 2
      i16 = storeProperty i0, i14, i12 # 2
      i17 = ret i0 # 2
  */});

  test('just object', function() {
    ({ a: 1, 2: x });
  }, function() {/*
    block B0
      i0 = object %2 # 2
      i2 = literal %"a" # 2
      i4 = literal %1 # 3
      i6 = storeProperty i0, i2, i4 # 2
      i7 = literal %2 # 2
      i9 = loadGlobal %"x" # 4
      i11 = storeProperty i0, i7, i9 # 2
      i12 = ret i0 # 2
  */});

  test('empty block', function() {
  }, function() {/*
    block B0
      i0 = literal %undefined # 0
      i2 = ret i0 # 0
  */});

  test('just a conditional expression', function() {
    a ? b : c;
  }, function() {/*
    block B0 -> B1, B2
      i0 = loadGlobal %"a" # 3
      i2 = branch i0 # 2
    block B1 -> B3
      i3 = loadGlobal %"b" # 4
      i5 = to_phi i6, i3 # 2
    block B2 -> B3
      i7 = loadGlobal %"c" # 5
      i9 = to_phi i6, i7 # 2
    block B3
      i6 = phi # 2
      i10 = ret i6 # 2
  */});

  test('just an anonymous function expression', function() {
    (function() {
      return 1;
    })()
  }, function() {/*
    block B0
      i0 = fn %"B1" # 3
      i2 = global # 2
      i3 = call i0, i2, %0 # 2
      i5 = ret i3 # 2
    ----
    block B1
      i0 = literal %1 # 6
      i2 = ret i0 # 5
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
      i0 = fn %"B1" # 1
      i2 = storeGlobal %"a", i0 # 0
      i4 = loadGlobal %"a" # 28
      i6 = literal %1 # 29
      i8 = literal %2 # 30
      i10 = literal %3 # 31
      i12 = pushArg i10 # 27
      i13 = pushArg i8 # 27
      i14 = pushArg i6 # 27
      i15 = global # 27
      i16 = call i4, i15, %3 # 27
      i18 = ret i16 # 27
    ----
    block B1 -> B2, B3
      @b = loadArg %0 # 1
      @c = loadArg %1 # 1
      @d = loadArg %2 # 1
      i6 = self # 6
      i7 = literal %0 # 7
      i9 = literal %0 # 8
      i11 = literal %0 # 9
      i13 = pushArg i11 # 5
      i14 = pushArg i9 # 5
      i15 = pushArg i7 # 5
      i16 = global # 5
      i17 = call i6, i16, %3 # 5
      i19 = literal %0 # 10
      i21 = binary %"<", i17, i19 # 4
      i23 = branch i21 # 3
    block B2
      i24 = literal %0 # 15
      i26 = binary %"-", i24, @b # 14
      i29 = binary %"-", i26, @c # 13
      i32 = binary %"-", i29, @d # 12
      i35 = ret i32 # 11
    block B3 -> B4
    block B4
      i36 = binary %"+", @b, @c # 21
      i40 = binary %"+", i36, @d # 20
      i43 = ret i40 # 19
  */});

  test('just a this expression', function() {
    this.a;
  }, function() {/*
    block B0
      i0 = literal %"a" # 2
      i2 = this # 3
      i3 = loadProperty i2, i0 # 2
      i4 = ret i3 # 2
  */});

  test('call with context', function() {
    a.b();
  }, function() {/*
    block B0
      i0 = literal %"b" # 3
      i2 = loadGlobal %"a" # 4
      i4 = loadProperty i2, i0 # 3
      i5 = call i4, i2, %0 # 2
      i7 = ret i5 # 2
  */});

  test('function with no return', function() {
    function test(a) {
      a;
    }
  }, function() {/*
    block B0
      i0 = fn %"B1" # 1
      i2 = storeGlobal %"test", i0 # 0
      i4 = literal %undefined # 0
      i6 = ret i4 # 0
    ----
    block B1
      @a = loadArg %0 # 1
      i2 = literal %undefined # 1
      i4 = ret i2 # 1
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
      i0 = fn %"B1" # 1
      i2 = storeGlobal %"run", i0 # 0
      i4 = loadGlobal %"run" # 22
      i6 = global # 21
      i7 = call i4, i6, %0 # 21
      i9 = ret i7 # 21
    ----
    block B1 -> B4
      @x = literal %undefined # 1
      @i = literal %undefined # 1
      @x = literal %1 # 4
      @i = literal %0 # 7
    block B2 -> B4
      i8 = nop @i # 15
      i10 = literal %1 # 15
      @i = binary %"+", i8, i10 # 15
    block B3 -> B7
    block B4 -> B5
    block B5 -> B6, B3
      i14 = literal %10 # 10
      i16 = binary %"<", @i, i14 # 8
      i19 = branch i16 # 5
    block B6 -> B2
      @x = binary %"+", @x, @i # 12
    block B7
      i24 = ret @x # 17
  */});

  test('just context regression', function() {
    function outer() {
      var x;
      return function inner() {
        return x;
      }
    }
  }, function() {/*
    block B0
      @outer = fn %"B1" # 1
      i2 = literal %undefined # 0
      i4 = ret i2 # 0
    ----
    block B1
      i0 = literal %undefined # 1
      i2 = storeContext %0, %0, i0 # 1
      i5 = fn %"B0" # 5
      i7 = ret i5 # 4
    ----
    block B0
      i0 = loadContext %1, %0 # 5
      i3 = ret i0 # 5
  */}, {
    global: false
  });

  test('just local regression', function() {
    var x;
    x + x;
  }, function() {/*
    block B0
      @x = literal %undefined # 0
      i2 = binary %"+", @x, @x # 3
      i6 = literal %undefined # 0
      i8 = ret i6 # 0
  */}, {
    global: false
  });
});
