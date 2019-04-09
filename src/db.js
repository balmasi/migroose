import mongoose, { Schema }  from 'mongoose';
import Promise from 'bluebird';
// Factory function for a mongoose model
mongoose.Promise = Promise;

export default function ( collection = 'migrations', dbConnection, {typescript} ) {

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
  	let basename = `${this.createdAt.getTime()}-${this.name}`;
  	if(typescript) return `${basename}.ts`;
    return `${basename}.js`;
  });

  dbConnection.on('error', err => {
    console.error(`MongoDB Connection Error: ${err}`);
  });

  return dbConnection.model( collection, MigrationSchema );
}

