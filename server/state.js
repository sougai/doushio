var _ = require('../lib/underscore'),
    async = require('async'),
    config = require('../config'),
    crypto = require('crypto'),
    fs = require('fs'),
    hooks = require('../hooks'),
    path = require('path'),
    pipeline = require('../pipeline'),
    vm = require('vm');

_.templateSettings = {
	interpolate: /\{\{(.+?)\}\}/g
};

exports.emitter = new (require('events').EventEmitter);

exports.dbCache = {
	OPs: {},
	opTags: {},
	threadSubs: {},
	YAKUMAN: 0,
	funThread: 0,
	addresses: {},
	ranges: {},
	connTokenSecretKey: null,
};

var HOT = exports.hot = {};
var RES = exports.resources = {};
exports.clients = {};
exports.clientsByIP = {};

function reload_hot_config(cb) {
	fs.readFile('hot.js', 'UTF-8', function (err, js) {
		if (err)
			cb(err);
		var hot = {};
		try {
			vm.runInNewContext(js, hot);
		}
		catch (e) {
			return cb(e);
		}
		if (!hot || !hot.hot)
			return cb('Bad hot config.');

		// Overwrite the original object just in case
		Object.keys(HOT).forEach(function (k) {
			delete HOT[k];
		});
		_.extend(HOT, hot.hot);
		read_exits('exits.txt', function () {
			hooks.trigger('reloadHot', HOT, cb);
		});
	});
}

// load the encryption key for connToken
hooks.hook('reloadHot', function (hot, cb) {
	var r = global.redis;
	var key = 'ctoken-secret-key';
	r.get(key, function (err, secretHex) {
		if (err) return cb(err);
		if (secretHex) {
			var secretBytes = new Buffer(secretHex, 'hex');
			if (secretBytes.length != 32)
				return cb('ctoken secret key is invalid');
			HOT.connTokenSecretKey = secretBytes;
			return cb(null);
		}
		// generate a new one
		var secretKey = crypto.randomBytes(32);
		r.setnx(key, secretKey.toString('hex'), function (err, wasSet) {
			if (err) return cb(err);
			if (wasSet)
				HOT.connTokenSecretKey = secretKey;
			else
				assert(!!HOT.connTokenSecretKey);
			cb(null);
		});
	});
});

function reload_scripts(cb) {
	var json = path.join('state', 'scripts.json');
	fs.readFile(json, 'UTF-8', function (err, json) {
		if (err)
			cb(err);
		var js;
		try {
			js = JSON.parse(json);
		}
		catch (e) {
			return cb(e);
		}
		if (!js || !js.vendor || !js.client)
			return cb('Bad state/scripts.json.');

		HOT.VENDOR_JS = js.vendor;
		HOT.CLIENT_JS = js.client;

		var modJs = path.join('state', js.mod);
		fs.readFile(modJs, 'UTF-8', function (err, modSrc) {
			if (err)
				return cb(err);
			RES.modJs = modSrc;
			cb(null);
		});
	});
}

function reload_resources(cb) {

	var deps = require('../deps');

	read_templates(function (err, tmpls) {
		if (err)
			return cb(err);

		_.extend(RES, expand_templates(tmpls));

		hooks.trigger('reloadResources', RES, cb);
	});
}

function read_templates(cb) {
	function read(dir, file) {
		return fs.readFile.bind(fs, path.join(dir, file), 'UTF-8');
	}

	async.parallel({
		index: read('tmpl', 'index.html'),
		filter: read('tmpl', 'filter.html'),
		curfew: read('tmpl', 'curfew.html'),
		suspension: read('tmpl', 'suspension.html'),
		notFound: read('www', '404.html'),
		serverError: read('www', '50x.html'),
    teaway: read('tmpl', 'teaway.html'),
    manual: read('tmpl', 'manual.html'),
	}, cb);
}

function expand_templates(res) {
	var templateVars = _.clone(HOT);
	_.extend(templateVars, require('../imager/config'));
	_.extend(templateVars, config);

	function tmpl(data) {
		var expanded = _.template(data, templateVars);
		return {tmpl: expanded.split(/\$[A-Z]+/),
			src: expanded};
	}

	var ex = {
		navigationHtml: make_navigation_html(),
		filterTmpl: tmpl(res.filter).tmpl,
		curfewTmpl: tmpl(res.curfew).tmpl,
		suspensionTmpl: tmpl(res.suspension).tmpl,
		notFoundHtml: res.notFound,
		serverErrorHtml: res.serverError,
    teawayHtml: res.teaway,
    manualHtml: res.manual,
	};

	var index = tmpl(res.index);
	ex.indexTmpl = index.tmpl;
	var hash = crypto.createHash('md5').update(index.src);
	ex.indexHash = hash.digest('hex').slice(0, 8);

	return ex;
}

exports.reload_hot_resources = function (cb) {
	pipeline.refresh_deps();

	async.series([
		reload_hot_config,
		pipeline.rebuild,
		reload_scripts,
		reload_resources,
	], cb);
}

function make_navigation_html() {
	if (!HOT.INTER_BOARD_NAVIGATION)
		return '';
	var bits = ['<nav>['];
	config.BOARDS.forEach(function (board, i) {
		if (board == config.STAFF_BOARD)
			return;
		if (i > 0)
			bits.push(' / ');
		bits.push('<a href="../'+board+'/">'+board+'</a>');
	});
	bits.push(']</nav>');
	return bits.join('');
}

function read_exits(file, cb) {
	fs.readFile(file, 'UTF-8', function (err, lines) {
		if (err)
			return cb(err);
		var exits = [], dest = HOT.BANS;
		lines.split(/\n/g).forEach(function (line) {
			var m = line.match(/^(?:^#\d)*(\d+\.\d+\.\d+\.\d+)/);
			if (!m)
				return;
			var exit = m[1];
			if (dest.indexOf(exit) < 0)
				dest.push(exit);
		});
		cb(null);
	});
}
