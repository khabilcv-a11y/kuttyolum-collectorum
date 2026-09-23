/* Demo data for the local preview: a fake school master list plus a few sample submissions. */
(function (global) {
  'use strict';
  var PIN = '1234';

  var SCHOOLS = [
    ['GHSS Koduvally', '17040100101', 'Ramesh Kumar', '9447012345', 'Near Bus Stand, Koduvally, Kozhikode'],
    ['GVHSS Mukkam', '17040100202', 'Sherin Thomas', '9447023456', 'College Road, Mukkam, Kozhikode'],
    ['St. Joseph’s HSS Balussery', '17040100303', 'Anitha Varghese', '9447034567', 'Balussery Town, Kozhikode'],
    ['GHS Kunnamangalam', '17040100404', 'Suresh Nair', '9447045678', 'Kunnamangalam, Kozhikode'],
    ['Sacred Heart HSS Perambra', '17040100505', 'Fathima Beevi', '9447056789', 'Perambra, Kozhikode'],
    ['GHSS Vatakara', '17040200101', 'Vinod Menon', '9447067890', 'Court Road, Vatakara'],
    ['MEA HSS Koyilandy', '17040200202', 'Praveen Das', '9447078901', 'Koyilandy Beach Road, Kozhikode'],
    ['GVHSS Nadapuram', '17040200303', 'Latha Pillai', '9447089012', 'Nadapuram Town'],
    ['St. Mary’s HSS Thodannur', '17040200404', 'George Joseph', '9447090123', 'Thodannur, Kozhikode'],
    ['GHS Chombala', '17040200505', 'Rajitha K', '9447001234', 'Chombala Beach Road'],
    ['Providence Girls HSS Kozhikode City', '17040300101', 'Sr. Alphonsa', '9447112345', 'Convent Road, Kozhikode City'],
    ['GHSS Chevayur', '17040300202', 'Manoj P', '9447123456', 'Chevayur, Kozhikode'],
    ['Farook HSS Feroke', '17040300303', 'Ashraf Ali', '9447134567', 'Farook College Road, Feroke'],
    ['GVHSS Kozhikode Rural', '17040300404', 'Deepa Krishnan', '9447145678', 'West Hill, Kozhikode'],
    ['Al Ameen HSS Kozhikode City', '17040300505', 'Nazeer Ahmed', '9447156789', 'Mavoor Road, Kozhikode City']
  ];

  var DISTRICTS = { 'Kozhikode City': 'Kozhikode', 'Kozhikode Rural': 'Kozhikode', 'Chevayur': 'Kozhikode', 'Feroke': 'Kozhikode' };
  var SCHOOL_LOC = [
    'Kozhikode', 'Kozhikode', 'Kozhikode', 'Kozhikode', 'Kozhikode',
    'Vatakara', 'Vatakara', 'Vatakara', 'Vatakara', 'Vatakara',
    'Kozhikode', 'Kozhikode', 'Kozhikode', 'Kozhikode', 'Kozhikode'
  ];
  var SUB_LOC = [
    'Koduvally', 'Mukkam', 'Balussery', 'Kunnamangalam', 'Perambra',
    'Vatakara', 'Koyilandy', 'Nadapuram', 'Thodannur', 'Chombala',
    'Kozhikode City', 'Chevayur', 'Feroke', 'Kozhikode Rural', 'Kozhikode City'
  ];
  var ITYPE = ['Aided', 'Unaided', 'Private'];
  var RES = ['Fisheries', 'Girls Only', 'SC / ST', 'Rural Area', 'PWD'];
  var NO_RES = 'No Reservations';

  var seed = 7;
  function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  function submissionRow(i) {
    var idx = i % SCHOOLS.length;
    var sc = SCHOOLS[idx];
    var classes = shuffle(['5', '6', '7', '8', '9', '10']).slice(0, 2 + Math.floor(rnd() * 3)).sort();
    var reservations = rnd() < 0.45 ? [NO_RES] : shuffle(RES).slice(0, 1 + Math.floor(rnd() * 2));
    var now = new Date(Date.now() - Math.floor(rnd() * 8) * 86400000);
    return [
      'SUB-' + ('000' + (i + 1)).slice(-4), now, sc[0], 'LISTED', sc[1], pick(ITYPE),
      SCHOOL_LOC[idx], SUB_LOC[idx], sc[4], 80 + Math.floor(rnd() * 800), classes.join(', '),
      sc[2], sc[3], pick(['Divya Menon', 'Jaison Mathew', 'Reshma K', 'Anoop Varma']), '94470' + (10000 + Math.floor(rnd() * 89999)),
      'contact' + (i + 1) + '@school.edu.in', reservations.join(', '),
      rnd() < 0.15 ? 'Yes' : 'No', rnd() < 0.9 ? 'Yes' : 'No', rnd() < 0.85 ? 'Yes' : 'No',
      rnd() < 0.1 ? 'One student with a peanut allergy.' : '', true, 'ACTIVE', now, ''
    ];
  }

  global.seedDemo = function () {
    seed = 7;
    MockGAS.resetStore();
    var store = MockGAS.store();
    store.props.ADMIN_PIN = PIN;

    var schoolRows = [['School Name', 'UDISE Code', 'H.M/ contact', 'Phone', 'Address']].concat(SCHOOLS);
    store.sheets.Schools = schoolRows;
    store.order.push('Schools');

    setup();

    var subRows = [HEADERS_SUBMISSIONS()];
    for (var i = 0; i < 11; i++) subRows.push(submissionRow(i));
    store.sheets.Reservation_Submissions = subRows;

    function HEADERS_SUBMISSIONS() {
      return ['Submission ID', 'Timestamp', 'School Name', 'School Source', 'UDISE Code', 'Institution Type',
        'Educational District', 'Sub-District', 'Address', 'Total Students', 'Classes Participating',
        'Contact Person Name', 'Contact Person Mobile', 'Teacher Coordinator Name', 'Teacher Coordinator Mobile',
        'Email', 'Reservations', 'Accessibility Support', 'Parent Consent', 'Photo Video Consent',
        'Medical Info', 'Declaration', 'Status', 'Updated At', 'Updated By'];
    }

    store.cache = {};
    MockGAS.saveStore();
    console.log('[seed] demo data ready — admin PIN ' + PIN);
  };

  var subSeq = 100;
  global.simulateSubmission = function () {
    MockGAS.loadStore();
    var row = submissionRow(subSeq++);
    var store = MockGAS.store();
    store.sheets.Reservation_Submissions.push(row);
    store.cache = {};
    MockGAS.saveStore();
    return row[2] + ' submitted';
  };
})(window);
