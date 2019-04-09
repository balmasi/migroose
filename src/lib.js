var path = require('path');
var fs = require('fs');
var mkdirp = require('mkdirp');
var Promise = require('bluebird');
var colors = require('colors');
var mongoose = require('mongoose');
var _ = require('lodash');
var ask = require('inquirer');

var MigrationModelFactory = require('./db');
let MigrationModel;

Promise.config({
  warnings: false
});

const es6Template =
`
/**
 * Make any changes you need to make to the database here
 */
export async function up () {
  // Write migration here
}

/**
 * Make any changes that UNDO the up function side effects here (if possible)
 */
export async function down () {
  // Write migration here
}
`;

const es5Template =
`'use strict';

/**
 * Make any changes you need to make to the database here
 */
exports.up = function up (done) {
  done();
};

/**
 * Make any changes that UNDO the up function side effects here (if possible)
 */
exports.down = function down(done) {
  done();
};
`;


module.exports = class Migrator {
  constructor({
    templatePath,
    migrationsPath = './migrations',
    dbConnectionUri,
    es6Templates = false,
    typescript = false,
    collectionName = 'migrations',
    autosync = false,
    cli = false,
    connection
  }) {
    const defaultTemplate = typescript || es6Templates ?  es6Template : es5Template;
    this.template = templatePath ? fs.readFileSync(templatePath, 'utf-8') : defaultTemplate;
    this.migrationPath = path.resolve(migrationsPath);
    this.connection = connection || mongoose.createConnection(dbConnectionUri, { useNewUrlParser: true });
    this.es6 = es6Templates;
    this.typescript = typescript;
    this.collection = collectionName;
    this.autosync = autosync;
    this.cli = cli;
    MigrationModel = MigrationModelFactory(collectionName, this.connection, {typescript});
  }

  log (logString, force = false) {
    if (force || this.cli) {
      console.log(logString);
    }
  }

  /**
   * Use your own Mongoose connection object (so you can use this('modelname')
   * @param {mongoose.connection} connection - Mongoose connection
   */
  setMongooseConnection (connection) {
    MigrationModel = MigrationModelFactory(this.collection, connection)
  }

  /**
   * Close the underlying connection to mongo
   * @returns {Promise} A promise that resolves when connection is closed
   */
  close() {
    return this.connection ? this.connection.close() : Promise.resolve();
  }

  /**
   * Generate name for migration file with right extension
   * @param basename
   * @return {string}
   */
  getMigrationFileName(basename) {
    if (this.typescript) {
      return `${basename}.ts`
    };
    return `${basename}.js`;
  }

  /**
   * Create a new migration
   * @param {string} migrationName
   * @returns {Promise<Object>} A promise of the Migration created
   */
  async create(migrationName) {
    try {
      const existingMigration = await MigrationModel.findOne({ name: migrationName });
      if (!!existingMigration) {
        throw new Error(`There is already a migration with name '${migrationName}' in the database`.red);
      }

      await this.sync();
      const now = Date.now();
      const newMigrationFile = this.getMigrationFileName(`${now}-${migrationName}`);
      mkdirp.sync(this.migrationPath);
      fs.writeFileSync(path.join(this.migrationPath, newMigrationFile), this.template);
      // create instance in db
      await this.connection;
      const migrationCreated = await MigrationModel.create({
        name: migrationName,
        createdAt: now
      });
      this.log(`Created migration ${migrationName} in ${this.migrationPath}.`);
      return migrationCreated;
    } catch(error){
      this.log(error.stack);
      fileRequired(error);
    }
  }

  /**
   * Runs migrations up to or down to a given migration name
   *
   * @param migrationName
   * @param direction
   */
  async run(direction = 'up', migrationName) {
    await this.sync();

    if (direction !== 'up' && direction !== 'down') {
      throw new Error(`The '${direction}' is not supported, use the 'up' or 'down' direction`);
    }

    const untilMigration = migrationName ?
      await MigrationModel.findOne({name: migrationName}) :
      await MigrationModel.findOne().sort({createdAt: direction === 'up' ? -1 : 1});

    if (!untilMigration) {
      if (migrationName) throw new ReferenceError("Could not find that migration in the database");
      else throw new Error("There are no pending migrations.");
    }

    let query = {
      createdAt: {$lte: untilMigration.createdAt},
      state: 'down'
    };

    if (direction == 'down') {
      query = {
        createdAt: {$gte: untilMigration.createdAt},
        state: 'up'
      };
    }


    const sortDirection = direction == 'up' ? 1 : -1;
    const migrationsToRun = await MigrationModel.find(query)
      .sort({createdAt: sortDirection});

    if (!migrationsToRun.length) {
      if (this.cli) {
        this.log('There are no migrations to run'.yellow);
        this.log(`Current Migrations' Statuses: `);
        await this.list();
      }
      throw new Error('There are no migrations to run');
    }

    let self = this;
    let numMigrationsRan = 0;
    let migrationsRan = [];

    for (const migration of migrationsToRun) {
      const migrationFilePath = path.join(self.migrationPath, migration.filename);
      if (this.es6) {
        require('babel-register')({
          "presets": [require("babel-preset-latest")],
          "plugins": [require("babel-plugin-transform-runtime")]
        });

        require('babel-polyfill');
      }

      if (this.typescript) {
        require("ts-node").register({
          disableWarnings: true,
          transpileOnly: true
        });
      }

      let migrationFunctions;

      try {
        migrationFunctions = require(migrationFilePath);
      } catch (err) {
        err.message = err.message && /Unexpected token/.test(err.message) ?
          'Unexpected Token when parsing migration. If you are using an ES6 migration file, use option --es6' :
          err.message;
        throw err;
      }

      if (!migrationFunctions[direction]) {
        throw new Error (`The ${direction} export is not defined in ${migration.filename}.`.red);
      }

      try {
        await new Promise( (resolve, reject) => {
          const callPromise =  migrationFunctions[direction].call(
            this.connection.model.bind(this.connection),
            function callback(err) {
              if (err) return reject(err);
              resolve();
            }
          );

          if (callPromise && typeof callPromise.then === 'function') {
            callPromise.then(resolve).catch(reject);
          }
        });

        this.log(`${direction.toUpperCase()}:   `[direction == 'up'? 'green' : 'red'] + ` ${migration.filename} `);

        await MigrationModel.where({name: migration.name}).updateMany({$set: {state: direction}});
        migrationsRan.push(migration.toJSON());
        numMigrationsRan++;
      } catch(err) {
        this.log(`Failed to run migration ${migration.name} due to an error.`.red);
        this.log(`Not continuing. Make sure your data is in consistent state`.red);
        throw err instanceof(Error) ? err : new Error(err);
      }
    }

    if (migrationsToRun.length == numMigrationsRan) this.log('All migrations finished successfully.'.green);
    return migrationsRan;
  }

  /**
   * Looks at the file system migrations and imports any migrations that are
   * on the file system but missing in the database into the database
   *
   * This functionality is opposite of prune()
   */
  async sync() {
    try {
      const filesInMigrationFolder = fs.readdirSync(this.migrationPath);
      const migrationsInDatabase = await MigrationModel.find({});
      // Go over migrations in folder and delete any files not in DB
      const migrationsInFolder = _.filter(filesInMigrationFolder, file => /\d{13,}\-.+.(js|ts)$/.test(file))
        .map(filename => {
          const fileCreatedAt = parseInt(filename.split('-')[0]);
          const existsInDatabase = migrationsInDatabase.some(m => filename == m.filename);
          return {createdAt: fileCreatedAt, filename, existsInDatabase};
        });

      const filesNotInDb = _.filter(migrationsInFolder, {existsInDatabase: false}).map(f => f.filename);
      let migrationsToImport = filesNotInDb;
      this.log('Synchronizing database with file system migrations...');
      if (!this.autosync && migrationsToImport.length) {
        const answers = await new Promise(function (resolve) {
          ask.prompt({
            type: 'checkbox',
            message: 'The following migrations exist in the migrations folder but not in the database. Select the ones you want to import into the database',
            name: 'migrationsToImport',
            choices: filesNotInDb
          }, (answers) => {
            resolve(answers);
          });
        });

        migrationsToImport = answers.migrationsToImport;
      }

      return Promise.map(migrationsToImport, async (migrationToImport) => {
        const filePath = path.join(this.migrationPath, migrationToImport),
          timestampSeparatorIndex = migrationToImport.indexOf('-'),
          timestamp = migrationToImport.slice(0, timestampSeparatorIndex),
          migrationName = migrationToImport.slice(timestampSeparatorIndex + 1, migrationToImport.lastIndexOf('.'));

        this.log(`Adding migration ${filePath} into database require(file system. State is ` + `DOWN`.red);
        const createdMigration = await MigrationModel.create({
          name: migrationName,
          createdAt: timestamp
        });
        return createdMigration.toJSON();
      });
    } catch (error) {
      this.log(`Could not synchronise migrations in the migrations folder up to the database.`.red);
      throw error;
    }
  }

  /**
   * Opposite of sync().
   * Removes files in migration directory which don't exist in database.
   */
  async prune() {
    try {
      const filesInMigrationFolder = fs.readdirSync(this.migrationPath);
      const migrationsInDatabase = await MigrationModel.find({});
      // Go over migrations in folder and delete any files not in DB
      const migrationsInFolder = _.filter(filesInMigrationFolder, file => /\d{13,}\-.+.(js|ts)/.test(file) )
        .map(filename => {
          const fileCreatedAt = parseInt(filename.split('-')[0]);
          const existsInDatabase = migrationsInDatabase.some(m => filename == m.filename);
          return { createdAt: fileCreatedAt, filename,  existsInDatabase };
        });

      const dbMigrationsNotOnFs = _.filter(migrationsInDatabase, m => {
        return !_.find(migrationsInFolder, { filename: m.filename })
      });


      let migrationsToDelete = dbMigrationsNotOnFs.map( m => m.name );

      if (!this.autosync && !!migrationsToDelete.length) {
        const answers = await new Promise(function (resolve) {
          ask.prompt({
            type: 'checkbox',
            message: 'The following migrations exist in the database but not in the migrations folder. Select the ones you want to remove require(the file system.',
            name: 'migrationsToDelete',
            choices: migrationsToDelete
          }, (answers) => {
            resolve(answers);
          });
        });

        migrationsToDelete = answers.migrationsToDelete;
      }

      const migrationsToDeleteDocs = await MigrationModel
        .find({
          name: { $in: migrationsToDelete }
        }).lean();

      if (migrationsToDelete.length) {
        this.log(`Removing migration(s) `, `${migrationsToDelete.join(', ')}`.cyan, ` require(database`);
        await MigrationModel.deleteMany({
          name: { $in: migrationsToDelete }
        });
      }

      return migrationsToDeleteDocs;
    } catch(error) {
      this.log(`Could not prune extraneous migrations require(database.`.red);
      throw error;
    }
  }

  /**
   * Lists the current migrations and their statuses
   * @returns {Promise<Array<Object>>}
   * @example
   *   [
   *    { name: 'my-migration', filename: '149213223424_my-migration.js', state: 'up' },
   *    { name: 'add-cows', filename: '149213223453_add-cows.js', state: 'down' }
   *   ]
   */
  async list() {
    await this.sync();
    const migrations = await MigrationModel.find().sort({ createdAt: 1 });
    if (!migrations.length) this.log('There are no migrations to list.'.yellow);
    return migrations.map((m) => {
      this.log(
        `${m.state == 'up' ? 'UP:  \t' : 'DOWN:\t'}`[m.state == 'up'? 'green' : 'red'] +
        ` ${m.filename}`
      );
      return m.toJSON();
    });
  }
}

function fileRequired(error) {
  if (error && error.code == 'ENOENT') {
    throw new ReferenceError(`Could not find any files at path '${error.path}'`);
  }
}