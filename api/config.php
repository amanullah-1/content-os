<?php
// ContentOS local KV API — config (Laragon defaults).
// Override via environment variables if needed.

return [
  // NOTE: use 'localhost' (named pipe) and NOT '127.0.0.1' here.
  // On this machine 127.0.0.1:3306 is intercepted by WSL port-forwarding
  // (a MariaDB inside WSL), while Laragon's MySQL 8.4 is reached via
  // 'localhost' through the Windows named pipe.
  'host' => getenv('CONTENTOS_DB_HOST') ?: 'localhost',
  'port' => getenv('CONTENTOS_DB_PORT') ?: '3306',
  'name' => getenv('CONTENTOS_DB_NAME') ?: 'contentos',
  'user' => getenv('CONTENTOS_DB_USER') ?: 'root',
  'pass' => getenv('CONTENTOS_DB_PASS') !== false ? getenv('CONTENTOS_DB_PASS') : '',
];
