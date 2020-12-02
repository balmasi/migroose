const mongoose =  require('mongoose');
const Promise = require('bluebird');

// Factory function for a mongoose model
mongoose.Promise = Promise;
const { Schema } = mongoose;

function initializeDB( collection = 'migrations', dbConnection) {

  const MigrationSchema = new Schema({
    name: String,
    createdAt: Date,
    state: {
      type: String,
      enum: ['down', 'up'],
      default: 'down'
    }
  }, {
    collection: collection,
    toJSON: {
      virtuals: true,
      transform: function(doc, ret, options) {
        delete ret._id;
        delete ret.id;
        delete ret.__v;
        return ret;
      }
    }
  });

  MigrationSchema.virtual('filename').get(function() {
    return `${this.createdAt.getTime()}-${this.name}`;
  });

  dbConnection.on('error', err => {
    console.error(`MongoDB Connection Error: ${err}`);
  });

  return dbConnection.model(collection, MigrationSchema );
}

module.exports = initializeDB;
