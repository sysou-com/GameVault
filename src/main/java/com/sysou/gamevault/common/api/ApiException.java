package com.sysou.gamevault.common.api;

import org.springframework.http.HttpStatus;

/**
 * API 业务异常 → 统一错误封套 {@code {error:{code,message}}}（01 文档 §5）。
 * 非受检异常：控制器层直接抛，由 GlobalExceptionHandler 收口。
 */
public class ApiException extends RuntimeException {

    private final String code;
    private final HttpStatus status;

    public ApiException(String code, HttpStatus status, String message) {
        super(message);
        this.code = code;
        this.status = status;
    }

    public String code() { return code; }
    public HttpStatus status() { return status; }

    public static ApiException notFound(String code, String message) {
        return new ApiException(code, HttpStatus.NOT_FOUND, message);
    }

    public static ApiException badRequest(String code, String message) {
        return new ApiException(code, HttpStatus.BAD_REQUEST, message);
    }

    public static ApiException conflict(String code, String message) {
        return new ApiException(code, HttpStatus.CONFLICT, message);
    }

    public static ApiException tooMany(String code, String message) {
        return new ApiException(code, HttpStatus.TOO_MANY_REQUESTS, message);
    }

    public static ApiException unauthorized(String code, String message) {
        return new ApiException(code, HttpStatus.UNAUTHORIZED, message);
    }
}
