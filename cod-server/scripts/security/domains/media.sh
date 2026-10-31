# Media uploads (invalid bodies → validation 400 after the wall; never reaches the host)
ep POST "/api/media/uploads"                              products:manage        '{}'
ep PUT  "/api/media/uploads/{id}/content"                 products:manage
ep POST "/api/media/uploads/{id}/complete"                products:manage        '{}'
