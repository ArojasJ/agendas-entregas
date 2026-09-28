CREATE OR REPLACE FUNCTION decrement_product_stock(p_product_id UUID, p_amount INT)
RETURNS BOOLEAN AS $$
DECLARE updated INT;
BEGIN
  UPDATE products SET stock = stock - p_amount
  WHERE id = p_product_id AND stock >= p_amount;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_variant_stock(p_variant_id UUID, p_amount INT)
RETURNS BOOLEAN AS $$
DECLARE updated INT;
BEGIN
  UPDATE product_variants SET stock = stock - p_amount
  WHERE id = p_variant_id AND stock >= p_amount;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$ LANGUAGE plpgsql;
