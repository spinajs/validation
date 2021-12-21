import { Exception } from "@spinajs/exceptions";
import { ErrorObject } from "ajv";
/**
 * The exception that is thrown when JSON entity is checked against schema and is invalid
 */
 export class ValidationFailed extends Exception {
    public parameter: any;
  
    constructor(message: string, validationErrors: ValidationError[]) {
      super(message);
      this.parameter = validationErrors;
    }
  }

  export interface ValidationError extends ErrorObject
  {

  }