import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { configuration } from '../config/configuration';
import { buildDataSourceOptions } from './data-source-options';

/** Used by the TypeORM CLI (`npm run migration:*`). Reads the same env vars as the app. */
export default new DataSource(buildDataSourceOptions(configuration().database));
