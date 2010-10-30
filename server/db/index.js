var config = require('../config').config,
    fs = require('fs'),
    jsontemplate = require('../json-template'),
    postgres = require('../../../node-postgres/lib');

var db = new postgres.Client(config.DB_CONFIG);
db.connect();
db.on('error', function (err) {
	console.log(err);
	process.exit(1);
});

function create_table(table, sql_file, done) {
	console.log("Creating " + table + "...");
	var sql = fs.readFileSync(sql_file, 'UTF-8');
	var query = db.query(jsontemplate.Template(sql).expand(config));
	query.on('end', done);
}

function check_tables(done) {
	var post = config.DB_POST_TABLE, image = config.DB_IMAGE_TABLE;
	var exist = [];
	var query = db.query({
		text: "SELECT relname FROM pg_class WHERE relname IN ($1, $2)",
		values: [post, image]
	});
	query.on('row', function (row) {
		exist.push(row.fields[0]);
	});
	function post_table() {
		if (exist.indexOf(post) < 0)
			create_table(post, 'db/post_table.sql', done);
		else
			done();
	}
	query.on('end', function () {
		if (exist.indexOf(image) < 0)
			create_table(image, 'db/image_table.sql', post_table);
		else
			post_table();
	});
}

check_tables(function () {
	console.log("OK!");
	db.end();
});