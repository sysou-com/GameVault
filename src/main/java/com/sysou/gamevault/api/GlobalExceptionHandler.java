package com.sysou.gamevault.api;

import org.springframework.boot.web.servlet.error.DefaultErrorAttributes;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.bind.annotation.RestController;

import com.sysou.gamevault.common.api.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;

/**
 * 统一错误封套（01 文档 §5）：{@code {error:{code,message}}} + HTTP 语义码。
 */
@RestController
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String, Object>> api(ApiException e) {
        return ResponseEntity.status(e.status()).body(error(e.code(), e.getMessage()));
    }

    @ExceptionHandler({org.springframework.http.converter.HttpMessageNotReadableException.class,
            org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class})
    public ResponseEntity<Map<String, Object>> badBody(Exception e) {
        return ResponseEntity.badRequest().body(error("INVALID_BODY", "请求体不可解析或参数类型错误"));
    }

    @ExceptionHandler(java.io.FileNotFoundException.class)
    public ResponseEntity<Map<String, Object>> notFoundFile(java.io.FileNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(error("NOT_FOUND", "资源不存在"));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> other(Exception e) {
        log.error("未处理异常", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error("INTERNAL", "服务器内部错误"));
    }

    private Map<String, Object> error(String code, String message) {
        return Map.of("error", Map.of("code", code, "message", message));
    }
}
