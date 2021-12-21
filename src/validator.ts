import { AsyncModule, IContainer } from "@spinajs/di";
import Ajv from "ajv";
import { Configuration } from "@spinajs/configuration";
import * as fs from 'fs';
import * as glob from 'glob';
import * as path from 'path';
import { Logger, Log } from "@spinajs/log";
import { ValidationError, ValidationFailed } from "./exceptions";
import { InvalidArgument } from "@spinajs/exceptions";
import { SCHEMA_SYMBOL } from "./decorators";

export class DataValidator extends AsyncModule {

    protected Validator: Ajv.Ajv;

    protected Configuration: Configuration;

    protected Container: IContainer;

    @Logger()
    protected Log: Log;

    public async resolveAsync(container: IContainer): Promise<void> {

        this.Configuration = await container.resolve(Configuration);
        this.Container = container;

        const ajvConfig = {
            logger: {
                log: this.Log.info.bind(this.Log),
                warn: this.Log.warn.bind(this.Log),
                error: this.Log.error.bind(this.Log)
            },
            ...this.Configuration.get("validation") as any,
        }

        this.Validator = new Ajv(ajvConfig);

        // add $merge & $patch for json schema
        require("ajv-merge-patch")(this.Validator);

        // add common formats validation eg: date time
        require("ajv-formats")(this.Validator);

        // add keywords
        require("ajv-keywords")(this.Validator);

        this.Configuration.get<string[]>("system.dirs.schemas", [])
            .filter(dir => fs.existsSync(dir))
            .flatMap((d: string) => glob.sync(path.join(d, "*.json")))
            .map(f => {
                return {
                    schema: require(f),
                    file: path.basename(f)
                };
            })
            .filter(s => {
                const isValid = this.Validator.validateSchema(s.schema);

                if (!isValid) {
                    this.Log.warn(`Schema is not valid %s`, s.file);
                    return false;
                }

                return true;
            })
            .forEach(s => {
                const schemaId = s.schema.$id ?? path.basename(s.file);
                this.Log.trace(`Added schema ${schemaId}`);
                this.Validator.addSchema(s.schema, schemaId);
            });
    }


    /**
     * Tries to validate given data
     * 
     * @param data data to validate. Function will try to extract schema attached to object via @Schema decorator
     * @return { array : [boolean, ValidationError[]]} [0] true if data is valid, false otherwise, [1] list of all errors. If
     *                                                 set in config validation.allErrors is set to false, only firs error is returned
     */
    public tryValidate(data: any): [boolean, ValidationError[]]
    /**
     * Tries to validate given data
     * 
     * @param  {string|object|Boolean} schemaKeyRef key, ref or schema object
     * @param  {Any} data to be validated
     * @return { array : [boolean, ValidationError[]]} [0] true if data is valid, false otherwise, [1] list of all errors. If
     *                                                 set in config validation.allErrors is set to false, only firs error is returned
     */
    public tryValidate(schema: object | string | boolean, data: any): [boolean, ValidationError[]]
    public tryValidate(schemaOrData: object | string | boolean, data?: any): [boolean, ValidationError[]] {

        if (arguments.length === 1) {
            const schema = Reflect.getMetadata(SCHEMA_SYMBOL, schemaOrData);

            if (!schema) {
                return [false, [{
                    keyword: "empty_schema",
                    dataPath: "./",
                    schemaPath: "",
                    params: "data"
                }]];
            }

            const result = this.Validator.validate(schema, schemaOrData);
            if (!result) {
                return [false, this.Validator.errors]
            }

        } else {

            if (!data) {
                return [false, [{
                    keyword: "invalid_argument",
                    dataPath: "./",
                    schemaPath: "",
                    params: "data"
                }]]
            }

            let schema = schemaOrData || Reflect.getMetadata(SCHEMA_SYMBOL, schemaOrData);
            if (!schema) {
                return [false, [{
                    keyword: "empty_schema",
                    dataPath: "./",
                    schemaPath: "",
                    params: "data"
                }]];
            }

            const result = this.Validator.validate(schema, data);
            if (!result) {
                return [false, this.Validator.errors]
            }
        }


    }

    /**
     * Validate given data. When failed, exception is thrown
     * 
     * @param data data to validate. Function will try to extract schema attached to object via @Schema decorator
     * @throws {InvalidArgumen | ValidationFailed }
     */
    public validate(data: any): void;

    /**
     * Validate given data
     * 
     * @param  {string|object|Boolean} schemaKeyRef key, ref or schema object
     * @param  {Any} data to be validated
     * @throws {InvalidArgumen | ValidationFailed }
     */
    public validate(schema: object | string | boolean, data: any): void;
    public validate(schemaOrData: object | string | boolean, data?: any): void {
        const [isValid, errors] = this.tryValidate(schemaOrData, data);
        if (!isValid) {
            switch (errors[0].keyword) {
                case "invalid_argument":
                    throw new InvalidArgument("data is null or undefined");
                case "empty_schema":
                    throw new InvalidArgument("objects schema is not set");
                default:
                    throw new ValidationFailed("validation error", errors);

            }
        }
    }
}