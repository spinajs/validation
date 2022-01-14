import { SyncModule, IContainer } from "@spinajs/di";
import Ajv from "ajv";
import { Config, Configuration } from "@spinajs/configuration";
import * as fs from 'fs';
import * as glob from 'glob';
import * as path from 'path';
import { ValidationError, ValidationFailed } from "./exceptions";
import { InvalidArgument } from "@spinajs/exceptions";
import { SCHEMA_SYMBOL } from "./decorators";

export class DataValidator extends SyncModule {

    @Config("validation")
    public Options: any;

    @Config("system.dirs.schemas")
    public SchemaDirs: string[];

    protected Validator: Ajv;

    protected Configuration: Configuration;

    protected Container: IContainer;

    public resolve(container: IContainer) {
        this.Container = container;

        this.Validator = new Ajv(this.Options);

        // add $merge & $patch for json schema
        require("ajv-merge-patch")(this.Validator);

        // add common formats validation eg: date time
        require("ajv-formats")(this.Validator);

        // add keywords
        require("ajv-keywords")(this.Validator);

        this.SchemaDirs.filter(dir => fs.existsSync(dir))
            .flatMap((d: string) => glob.sync(path.join(d, "/**/*.+(json|js)")))
            .map(f => {
                return {
                    schema: require(f),
                    file: path.basename(f)
                };
            })
            .filter(s => this.Validator.validateSchema(s.schema))
            .forEach(s => this.Validator.addSchema(s.schema, s.schema.$id ?? path.basename(s.file)));
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
    public tryValidate(schema: object | string, data: any): [boolean, ValidationError[]]
    public tryValidate(schemaOrData: object | string, data?: any): [boolean, ValidationError[] | null | undefined] {

        if (arguments.length === 1) {
            const schema = Reflect.getMetadata(SCHEMA_SYMBOL, schemaOrData);

            if (!schema) {
                return [false, [{
                    keyword: "empty_schema",
                    instancePath: "./",
                    schemaPath: "",
                    params: { "data": "" }
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
                    instancePath: "./",
                    schemaPath: "",
                    params: { "data": "" }
                }]]
            }

            let schema = null;

            if (typeof schemaOrData === "object") {
                schema = schemaOrData;
            } else if (typeof schemaOrData === 'string') {
                const s = this.Validator.getSchema(schemaOrData);
                schema = s?.schema;
            } else {
                schema = Reflect.getMetadata(SCHEMA_SYMBOL, schemaOrData);
            }

            if (!schema) {
                return [false, [{
                    keyword: "empty_schema",
                    instancePath: "./",
                    schemaPath: "",
                    params: { "data": "" }
                }]];
            }

            const result = this.Validator.validate(schema, data);
            if (!result) {
                return [false, this.Validator.errors]
            }
        }

        return [true, undefined];
    }

    /**
     * Validate given data. When failed, exception is thrown
     * 
     * @param data data to validate. Function will try to extract schema attached to object via @Schema decorator
     * @throws {InvalidArgument | ValidationFailed }
     */
    public validate(data: any): void;

    /**
     * Validate given data
     * 
     * @param  {string|object|Boolean} schemaKeyRef key, ref or schema object
     * @param  {Any} data to be validated
     * @throws {InvalidArgumen | ValidationFailed }
     */
    public validate(schema: object | string, data: any): void;
    public validate(schemaOrData: object | string, data?: any): void {
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